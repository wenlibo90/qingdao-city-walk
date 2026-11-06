import {
  buildCoastTopology,
  bboxRing,
  centroidOf,
  dedupeRing,
  dist2,
  lonLatToLocal,
  pointInPolygon,
  polygonArea,
  simplifyRing,
  stitchCoastlines,
  type Vec2
} from '../core/geo';

interface GFeature {
  properties: Record<string, string>;
  geometry: { type: string; coordinates: unknown };
}

interface FeatureCollection {
  features: GFeature[];
  license?: string;
  source?: string;
}

export interface BuildingDef {
  id: number;
  name: string;
  tags: Record<string, string>;
  ring: Vec2[];
  holes: Vec2[][];
  centroid: Vec2;
  area: number;
}

export interface RoadDef {
  id: number;
  name: string;
  kind: string;
  points: Vec2[];
}

export interface GreenDef {
  ring: Vec2[];
  kind: string;
}

export interface ShipDef {
  id: number;
  name: string;
  ring: Vec2[];
  centroid: Vec2;
}

export interface StreetEntry {
  name: string;
  points: Vec2[][];
}

export interface WorldData {
  landOuter: Vec2[];
  islets: Vec2[][];
  piers: Vec2[][];
  water: Vec2[][];
  greens: GreenDef[];
  beaches: Vec2[][];
  coast: Vec2[][];
  buildings: BuildingDef[];
  roads: RoadDef[];
  roadAreas: Vec2[][];
  ships: ShipDef[];
  streets: StreetEntry[];
  attribution: string;
}

const GREEN_LEISURE = new Set(['park', 'garden', 'pitch', 'playground', 'stadium']);
const GREEN_NATURAL = new Set(['wood', 'grass', 'scrub', 'meadow', 'grassland']);
const GREEN_LANDUSE = new Set(['grass', 'forest', 'meadow', 'recreation_ground']);

function toLocalRing(coords: unknown): Vec2[] {
  const ring = coords as number[][];
  const local: Vec2[] = [];
  for (const c of ring) {
    const p = lonLatToLocal(c[0], c[1]);
    if (!local.length || dist2(p[0], p[1], local[local.length - 1][0], local[local.length - 1][1]) > 0.04) local.push(p);
  }
  if (local.length > 2) {
    const a = local[0], b = local[local.length - 1];
    if (dist2(a[0], a[1], b[0], b[1]) < 0.04) local.pop();
  }
  return local;
}

function cleanRing(coords: unknown): Vec2[] {
  return dedupeRing(simplifyRing(toLocalRing(coords), 0.22), 0.12);
}

function ringArea(ring: Vec2[]): number {
  return Math.abs(polygonArea(ring));
}

export async function loadWorld(url: string): Promise<WorldData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`无法加载 OSM 数据：${res.status}`);
  const raw = (await res.json()) as FeatureCollection;

  const buildings: BuildingDef[] = [];
  const roads: RoadDef[] = [];
  const roadAreas: Vec2[][] = [];
  const greens: GreenDef[] = [];
  const water: Vec2[][] = [];
  const beaches: Vec2[][] = [];
  const piers: Vec2[][] = [];
  const ships: ShipDef[] = [];
  const coastLines: Vec2[][] = [];
  const streetMap = new Map<string, Vec2[][]>();

  const addBuilding = (polys: number[][][][], p: Record<string, string>, baseId: number) => {
    let added = 0;
    for (const poly of polys) {
      if (!Array.isArray(poly) || poly.length === 0) continue;
      const rings = poly
        .map((ring) => cleanRing(ring))
        .filter((ring) => ring.length >= 3);
      if (rings.length === 0) continue;
      const outer = rings[0];
      const holes = rings.slice(1).filter((h) => ringArea(h) > 3);
      let area = ringArea(outer);
      for (const h of holes) area -= ringArea(h);
      if (area < 7) continue;
      buildings.push({
        id: baseId * 10 + added,
        name: p.name ?? '',
        tags: p,
        ring: outer,
        holes,
        centroid: centroidOf(outer),
        area: Math.max(1, area)
      });
      added++;
    }
  };

  for (const f of raw.features) {
    const p = f.properties ?? {};
    const g = f.geometry;
    if (!g) continue;

    if (p.natural === 'coastline' && g.type === 'LineString') {
      const pts = (g.coordinates as number[][]).map((c) => lonLatToLocal(c[0], c[1]));
      coastLines.push(pts);
      continue;
    }

    const polys: number[][][][] =
      g.type === 'Polygon'
        ? [g.coordinates as number[][][]]
        : g.type === 'MultiPolygon'
          ? (g.coordinates as number[][][][])
          : [];

    if (polys.length) {
      if (p.building || p['building:part']) {
        if (p['building:part'] && !p.building) continue;
        addBuilding(polys, p, Number(p._id ?? 0));
        continue;
      }

      for (const poly of polys) {
        const ring = cleanRing(poly[0]);
        if (ring.length < 3) continue;
        const area = ringArea(ring);
        if (area < 2) continue;

        if (p.building === 'ship') {
          ships.push({ id: Number(p._id ?? 0), name: p.name ?? '', ring, centroid: centroidOf(ring) });
          continue;
        }

        if (p.man_made === 'pier') {
          piers.push(ring);
          continue;
        }

        if (p.natural === 'water') {
          water.push(ring);
          continue;
        }

        if (p.natural === 'beach' || p.natural === 'sand') {
          beaches.push(ring);
          continue;
        }

        if (p.highway) {
          roadAreas.push(ring);
          continue;
        }

        const greenKind = GREEN_LEISURE.has(p.leisure ?? '')
          ? p.leisure
          : GREEN_NATURAL.has(p.natural ?? '')
            ? p.natural
            : GREEN_LANDUSE.has(p.landuse ?? '')
              ? p.landuse
              : null;
        if (greenKind) {
          greens.push({ ring, kind: greenKind });
          continue;
        }
      }
      continue;
    }

    if (g.type === 'LineString') {
      if (!p.highway) continue;
      const pts = (g.coordinates as number[][]).map((c) => lonLatToLocal(c[0], c[1]));
      if (pts.length < 2) continue;
      roads.push({ id: Number(p._id ?? 0), name: p.name ?? '', kind: p.highway, points: pts });
      if (p.name) {
        const entry = streetMap.get(p.name) ?? [];
        entry.push(pts);
        streetMap.set(p.name, entry);
      }
      const en = p['name:en'];
      if (en) {
        const entry = streetMap.get(en) ?? [];
        entry.push(pts);
        streetMap.set(en, entry);
      }
    }
  }

  const chains = stitchCoastlines(coastLines);
  const topo = buildCoastTopology(chains);
  const landOuter = bboxRing();
  const waterHoles = [...topo.water, ...water];
  const islets = topo.islets;
  const coast = [...waterHoles, ...islets];

  const streets: StreetEntry[] = [...streetMap.entries()]
    .map(([name, points]) => ({ name, points }))
    .filter((s) => s.points.some((pts) => pts.length >= 2))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  return {
    landOuter,
    piers,
    water: waterHoles,
    islets,
    greens,
    beaches,
    coast,
    buildings,
    roads,
    roadAreas,
    ships,
    streets,
    attribution: raw.license ?? '© OpenStreetMap contributors (ODbL)'
  };
}

export function findBuilding(data: WorldData, keyword: string): BuildingDef | undefined {
  return data.buildings.find((b) => b.name.includes(keyword));
}

export function pointOnLand(x: number, z: number, data: WorldData): boolean {
  for (const ring of data.islets) if (pointInPolygon(x, z, ring)) return true;
  if (!pointInPolygon(x, z, data.landOuter)) return false;
  for (const ring of data.water) if (pointInPolygon(x, z, ring)) return false;
  return true;
}

export function pointOnPier(x: number, z: number, data: WorldData): boolean {
  for (const ring of data.piers) if (pointInPolygon(x, z, ring)) return true;
  return false;
}
