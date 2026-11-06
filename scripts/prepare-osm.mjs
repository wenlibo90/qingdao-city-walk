import fs from 'node:fs';
import path from 'node:path';
import osmtogeojson from 'osmtogeojson';

const rawPath = process.argv[2] || '/tmp/osm-expanded.json';
const outPath = process.argv[3] || 'public/data/qingdao-city.geojson';
const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

const KEEP = new Set([
  'name', 'name:en', 'name:zh', 'building', 'building:part', 'building:levels', 'building:min_level',
  'height', 'min_height', 'building:colour', 'roof:colour', 'roof:shape', 'highway', 'surface',
  'natural', 'water', 'waterway', 'man_made', 'leisure', 'landuse', 'tourism', 'historic', 'amenity',
  'place', 'religion', 'denomination', 'area', 'layer', 'wikidata', 'wikipedia', 'start_date',
  'addr:street', 'addr:housenumber', 'ferry', 'public_transport', 'railway', 'bridge', 'tunnel',
  'artwork_type', 'artist_name', 'material'
]);

const AREA_TAGS = [
  ['man_made', new Set(['pier', 'lighthouse', 'monument'])],
  ['leisure', new Set(['park', 'garden', 'pitch', 'playground', 'sports_centre', 'stadium'])],
  ['landuse', new Set(['grass', 'forest', 'meadow', 'recreation_ground', 'cemetery', 'school', 'residential'])],
  ['natural', new Set(['water', 'wood', 'beach', 'sand', 'scrub', 'grassland'])],
  ['tourism', new Set(['attraction', 'museum', 'viewpoint', 'zoo', 'theme_park', 'artwork'])],
  ['amenity', new Set(['school', 'university', 'hospital', 'place_of_worship', 'parking'])],
  ['historic', new Set(['building', 'yes'])],
  ['railway', new Set(['station', 'platform'])]
];

const isArea = (tags, closed) => {
  if (!closed) return false;
  if (tags.building || tags['building:part']) return true;
  if (tags.area === 'yes') return true;
  if (tags.natural === 'water') return true;
  for (const [key, values] of AREA_TAGS) if (values.has(tags[key])) return true;
  return false;
};

const roundRing = (ring) => {
  const out = [];
  for (const c of ring) {
    const p = [Math.round(c[0] * 1e7) / 1e7, Math.round(c[1] * 1e7) / 1e7];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out;
};
const roundCoords = (coords) => coords.map((c) => [Math.round(c[0] * 1e7) / 1e7, Math.round(c[1] * 1e7) / 1e7]);

const geo = osmtogeojson(raw, { flatProperties: true });
const features = [];
let skipped = 0;
for (const f of geo.features) {
  if (!f.geometry) { skipped++; continue; }
  const tags = f.properties || {};
  const type = f.geometry.type;
  const props = {};
  for (const [k, v] of Object.entries(tags)) {
    if (KEEP.has(k)) props[k] = v;
  }
  const rawId = String(tags['@id'] ?? tags.id ?? '');
  const id = Number(rawId.replace(/^(way|relation|node)\//, '')) || 0;
  props._id = id;
  props._kind = rawId.split('/')[0] || 'way';

  if ((type === 'Polygon' || type === 'MultiPolygon') && tags.natural === 'coastline') {
    const polys = type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        features.push({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: roundRing(ring) } });
      }
    }
    continue;
  }

  if (type === 'Polygon' || type === 'MultiPolygon') {
    const polys = type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = polys.map((poly) => poly.map(roundRing));
    const closed = rings.every((poly) => poly.every((r) => r.length > 3));
    if (!closed) { skipped++; continue; }
    if (!isArea(tags, true)) {
      if (tags.highway) {
        // pedestrian plazas / squares
        features.push({ type: 'Feature', properties: props, geometry: { type, coordinates: rings } });
        continue;
      }
      skipped++;
      continue;
    }
    features.push({ type: 'Feature', properties: props, geometry: { type, coordinates: type === 'Polygon' ? rings[0] : rings } });
    continue;
  }

  if (type === 'LineString') {
    if (!tags.highway && tags.natural !== 'coastline' && !tags.waterway && !tags.railway && tags.man_made !== 'pier') { skipped++; continue; }
    features.push({ type: 'Feature', properties: props, geometry: { type, coordinates: roundCoords(f.geometry.coordinates) } });
    continue;
  }
  skipped++;
}

const bbox = [120.3030, 36.0435, 120.3920, 36.0770];
const out = {
  type: 'FeatureCollection',
  name: 'Qingdao Zhanqiao - Badaguan - May Fourth Square',
  bbox,
  license: 'ODbL 1.0 - © OpenStreetMap contributors',
  source: 'https://www.openstreetmap.org - Overpass API, retrieved 2026-11-06',
  features
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));
const bytes = fs.statSync(outPath).size;
const counts = {};
for (const f of features) {
  const p = f.properties;
  const k = p.building ? 'building' : p.highway ? 'highway' : p.natural === 'coastline' ? 'coastline' : p.natural || p.man_made || p.leisure || p.landuse || 'other';
  counts[k] = (counts[k] ?? 0) + 1;
}
console.log(`features=${features.length} skipped=${skipped} size=${(bytes / 1024 / 1024).toFixed(2)}MB`);
console.log(counts);
const holes = features.filter((f) => f.geometry.type === 'Polygon' && f.geometry.coordinates.length > 1).length;
const multi = features.filter((f) => f.geometry.type === 'MultiPolygon').length;
console.log(`polygon-with-holes=${holes} multipolygon=${multi}`);
