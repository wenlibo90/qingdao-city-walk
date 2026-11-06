import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const BBOX = { west: 120.3030, south: 36.0435, east: 120.3920, north: 36.0770 };
const ORIGIN = { lon: 120.3175, lat: 36.06175 };
const Z = Number(process.env.DEM_Z || 15);
const CELL = Number(process.env.DEM_CELL || 8);
const CACHE = '/tmp/qingdao-dem-tiles';
const OUT_BIN = 'public/data/qingdao-dem.bin';
const OUT_META = 'public/data/qingdao-dem.json';

const R = 6378137;
const D = Math.PI / 180;
const cosLat = 1; // keep scene projection in Web Mercator meters for consistency

const mercY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + lat * D / 2));
const originY = mercY(ORIGIN.lat);
const project = (lon, lat) => [R * (lon - ORIGIN.lon) * D, -(mercY(lat) - originY)];
const unproject = (x, z) => {
  const lon = ORIGIN.lon + x / (R * D);
  const lat = (2 * Math.atan(Math.exp((originY - z) / R)) - Math.PI / 2) / D;
  return [lon, lat];
};

const nw = project(BBOX.west, BBOX.north);
const se = project(BBOX.east, BBOX.south);
const xMin = nw[0], zMin = nw[1], xMax = se[0], zMax = se[1];
const cols = Math.ceil((xMax - xMin) / CELL) + 1;
const rows = Math.ceil((zMax - zMin) / CELL) + 1;

const tileX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const tileY = (lat) => {
  const rad = lat * D;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** Z);
};
const x0 = tileX(BBOX.west), x1 = tileX(BBOX.east);
const y0 = tileY(BBOX.north), y1 = tileY(BBOX.south);

const tiles = new Map();
const keyOf = (x, y) => `${x},${y}`;

async function fetchTile(x, y) {
  const dir = path.join(CACHE, String(Z), String(x));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${y}.png`);
  if (fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    tiles.set(keyOf(x, y), PNG.sync.read(buf));
    return;
  }
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(file, buf);
    tiles.set(keyOf(x, y), PNG.sync.read(buf));
    return;
  }
}

console.log(`DEM z=${Z} grid ${cols}x${rows} cell=${CELL}m tiles=${(x1 - x0 + 1) * (y1 - y0 + 1)}`);
const jobs = [];
for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
const concurrency = 6;
for (let i = 0; i < jobs.length; i += concurrency) {
  const batch = jobs.slice(i, i + concurrency);
  await Promise.all(batch.map(([x, y]) => fetchTile(x, y)));
  process.stdout.write(`\r下载 DEM 瓦片 ${Math.min(i + concurrency, jobs.length)}/${jobs.length}`);
}
process.stdout.write('\n');

function demPixel(lon, lat) {
  const n = 2 ** Z;
  const px = ((lon + 180) / 360) * n * 256;
  const rad = lat * D;
  const py = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n * 256;
  const tx = Math.floor(px / 256), ty = Math.floor(py / 256);
  const lx = px - tx * 256, ly = py - ty * 256;
  const tile = tiles.get(keyOf(tx, ty));
  if (!tile) return 0;
  const x0p = Math.max(0, Math.min(255, Math.floor(lx)));
  const y0p = Math.max(0, Math.min(255, Math.floor(ly)));
  const x1p = Math.min(255, x0p + 1);
  const y1p = Math.min(255, y0p + 1);
  const fx = lx - x0p, fy = ly - y0p;
  const hAt = (xi, yi) => {
    const i = (yi * tile.width + xi) * 4;
    return (tile.data[i] * 256 + tile.data[i + 1] + tile.data[i + 2] / 256) - 32768;
  };
  const a = hAt(x0p, y0p), b = hAt(x1p, y0p), c = hAt(x0p, y1p), d = hAt(x1p, y1p);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

const heights = new Int16Array(cols * rows);
let min = Infinity, max = -Infinity;
for (let j = 0; j < rows; j++) {
  for (let i = 0; i < cols; i++) {
    const x = xMin + i * CELL;
    const z = zMin + j * CELL;
    const [lon, lat] = unproject(x, z);
    let h = demPixel(lon, lat);
    if (!Number.isFinite(h)) h = 0;
    h = Math.max(0, h);
    const dm = Math.round(h * 10);
    heights[j * cols + i] = dm;
    if (h < min) min = h;
    if (h > max) max = h;
  }
  if (j % 80 === 0) process.stdout.write(`\r采样 DEM ${j}/${rows}`);
}
process.stdout.write('\n');

fs.mkdirSync(path.dirname(OUT_BIN), { recursive: true });
fs.writeFileSync(OUT_BIN, Buffer.from(heights.buffer));
fs.writeFileSync(OUT_META, JSON.stringify({
  bbox: BBOX,
  z: Z,
  xMin, zMin, xMax, zMax,
  cell: CELL,
  cols, rows,
  scale: 10,
  min, max,
  source: 'Mapzen/AWS Terrain Tiles (Terrarium), 3DEP/ETOPO',
  license: 'Public domain / CC-BY 4.0 (see terrain tiles attribution)'
}, null, 2));

const sample = (lon, lat) => {
  const [x, z] = project(lon, lat);
  const fi = Math.max(0, Math.min(cols - 1, (x - xMin) / CELL));
  const fj = Math.max(0, Math.min(rows - 1, (z - zMin) / CELL));
  const i0 = Math.min(cols - 2, Math.floor(fi)), j0 = Math.min(rows - 2, Math.floor(fj));
  const fx = fi - i0, fz = fj - j0;
  const g = (i, j) => heights[j * cols + i] / 10;
  return (g(i0, j0) * (1 - fx) + g(i0 + 1, j0) * fx) * (1 - fz) + (g(i0, j0 + 1) * (1 - fx) + g(i0 + 1, j0 + 1) * fx) * fz;
};
for (const [name, lon, lat] of [
  ['栈桥', 120.3149, 36.0605], ['圣弥爱尔', 120.3156, 36.0680], ['信号山', 120.32636, 36.06675],
  ['八大关', 120.348, 36.055], ['五月的风', 120.38015, 36.06121], ['奥帆中心', 120.3900, 36.0600],
  ['小青岛', 120.3187, 36.0530], ['太平角', 120.352, 36.052], ['湛山', 120.365, 36.065]
]) console.log(name, sample(lon, lat).toFixed(1) + 'm');
console.log(`DEM min=${min.toFixed(1)} max=${max.toFixed(1)} size=${(heights.byteLength / 1024 / 1024).toFixed(2)}MB`);
