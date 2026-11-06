export type Vec2 = [number, number];

export const BBOX = { west: 120.3030, south: 36.0435, east: 120.3920, north: 36.0770 };
const ORIGIN = { lon: 120.3175, lat: 36.06175 };

const R = 6378137;
const D = Math.PI / 180;

function mercY(lat: number): number {
  return R * Math.log(Math.tan(Math.PI / 4 + lat * D / 2));
}

const originY = mercY(ORIGIN.lat);

export function project(lon: number, lat: number): Vec2 {
  return [R * (lon - ORIGIN.lon) * D, -(mercY(lat) - originY)];
}

const nw = project(BBOX.west, BBOX.north);
const se = project(BBOX.east, BBOX.south);

export const LOCAL_BOUNDS = {
  xMin: nw[0],
  xMax: se[0],
  zMin: nw[1],
  zMax: se[1],
  get width() { return this.xMax - this.xMin; },
  get height() { return this.zMax - this.zMin; },
  centerX: (nw[0] + se[0]) / 2,
  centerZ: (nw[1] + se[1]) / 2
};

export function lonLatToLocal(lon: number, lat: number): Vec2 {
  return project(lon, lat);
}

export function localToLonLat(x: number, z: number): [number, number] {
  const lon = ORIGIN.lon + x / (R * D);
  const y = originY - z;
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / D;
  return [lon, lat];
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

export function polygonArea(ring: Vec2[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function centroidOf(ring: Vec2[]): Vec2 {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  return [x / ring.length, z / ring.length];
}

export function pointInPolygon(x: number, z: number, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1];
    const xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInPolygons(x: number, z: number, polys: Vec2[][]): boolean {
  for (const p of polys) if (pointInPolygon(x, z, p)) return true;
  return false;
}

export function simplifyRing(ring: Vec2[], tolerance = 0.35): Vec2[] {
  if (ring.length <= 4) return ring;
  const sq = tolerance * tolerance;
  const out: Vec2[] = [ring[0]];
  let last = ring[0];
  for (let i = 1; i < ring.length - 1; i++) {
    const p = ring[i];
    if (dist2(p[0], p[1], last[0], last[1]) >= sq) {
      out.push(p);
      last = p;
    }
  }
  out.push(ring[ring.length - 1]);
  return out;
}

export function dedupeRing(ring: Vec2[], eps = 0.08): Vec2[] {
  if (ring.length < 3) return ring;
  const out: Vec2[] = [];
  for (const p of ring) {
    if (!out.length || dist2(p[0], p[1], out[out.length - 1][0], out[out.length - 1][1]) > eps * eps) out.push(p);
  }
  if (out.length > 2) {
    const first = out[0], last = out[out.length - 1];
    if (dist2(first[0], first[1], last[0], last[1]) < eps * eps) out.pop();
  }
  return out;
}

interface Rect { xMin: number; xMax: number; zMin: number; zMax: number; }

function clipSegment(ax: number, az: number, bx: number, bz: number, r: Rect): [number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  const p = [-dx, dx, -dz, dz];
  const q = [ax - r.xMin, r.xMax - ax, az - r.zMin, r.zMax - az];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return t1 > t0 ? [t0, t1] : null;
}

export function clipPolylineToBounds(pts: Vec2[], r: Rect = LOCAL_BOUNDS): Vec2[][] {
  const pieces: Vec2[][] = [];
  let current: Vec2[] = [];
  const push = (p: Vec2) => {
    if (!current.length || dist2(p[0], p[1], current[current.length - 1][0], current[current.length - 1][1]) > 0.0025) current.push(p);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const res = clipSegment(a[0], a[1], b[0], b[1], r);
    if (!res) {
      if (current.length > 1) pieces.push(current);
      current = [];
      continue;
    }
    const [t0, t1] = res;
    const p0: Vec2 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
    const p1: Vec2 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
    if (!current.length) current = [p0];
    else if (dist2(p0[0], p0[1], current[current.length - 1][0], current[current.length - 1][1]) > 0.05) {
      if (current.length > 1) pieces.push(current);
      current = [p0];
    }
    push(p1);
  }
  if (current.length > 1) pieces.push(current);
  return pieces;
}

const keyOf = (p: Vec2) => `${Math.round(p[0] * 20)}:${Math.round(p[1] * 20)}`;

export interface CoastChain { pts: Vec2[]; closed: boolean; }

export function stitchCoastlines(lines: Vec2[][]): CoastChain[] {
  const closed: CoastChain[] = [];
  const open: Vec2[][] = [];
  for (const raw of lines) {
    if (raw.length < 2) continue;
    const a = raw[0], b = raw[raw.length - 1];
    if (raw.length > 3 && dist2(a[0], a[1], b[0], b[1]) < 1) closed.push({ pts: raw, closed: true });
    else open.push(raw);
  }

  const chains: Vec2[][] = [];
  const used = new Array(open.length).fill(false);
  const startMap = new Map<string, number[]>();
  const endMap = new Map<string, number[]>();
  open.forEach((l, i) => {
    (startMap.get(keyOf(l[0])) ?? startMap.set(keyOf(l[0]), []).get(keyOf(l[0]))!).push(i);
    (endMap.get(keyOf(l[l.length - 1])) ?? endMap.set(keyOf(l[l.length - 1]), []).get(keyOf(l[l.length - 1]))!).push(i);
  });

  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    let chain = [...open[i]];
    let changed = true;
    while (changed) {
      changed = false;
      const endKey = keyOf(chain[chain.length - 1]);
      const candidates = startMap.get(endKey) ?? [];
      for (const j of candidates) {
        if (used[j]) continue;
        used[j] = true;
        chain = chain.concat(open[j].slice(1));
        changed = true;
        break;
      }
      if (changed) continue;
      const startKey = keyOf(chain[0]);
      const back = endMap.get(startKey) ?? [];
      for (const j of back) {
        if (used[j]) continue;
        used[j] = true;
        chain = open[j].slice(0, -1).concat(chain);
        changed = true;
        break;
      }
    }
    chains.push(chain);
  }

  return [...closed, ...chains.map((pts) => ({ pts, closed: false }))];
}

function edgeParam(p: Vec2, r: Rect): number {
  const H = r.zMax - r.zMin;
  const W = r.xMax - r.xMin;
  const dW = Math.abs(p[0] - r.xMin);
  const dE = Math.abs(p[0] - r.xMax);
  const dN = Math.abs(p[1] - r.zMin);
  const dS = Math.abs(p[1] - r.zMax);
  const m = Math.min(dW, dE, dN, dS);
  if (m === dW) return Math.max(0, Math.min(H, p[1] - r.zMin));
  if (m === dS) return H + Math.max(0, Math.min(W, p[0] - r.xMin));
  if (m === dE) return H + W + Math.max(0, Math.min(H, r.zMax - p[1]));
  return 2 * H + W + Math.max(0, Math.min(W, r.xMax - p[0]));
}

function boundaryCCW(from: Vec2, to: Vec2, r: Rect): Vec2[] {
  const H = r.zMax - r.zMin;
  const W = r.xMax - r.xMin;
  const per = 2 * (H + W);
  let ta = edgeParam(from, r);
  let tb = edgeParam(to, r);
  if (tb <= ta + 1e-6) tb += per;
  const corners: Array<{ t: number; p: Vec2 }> = [
    { t: H, p: [r.xMin, r.zMax] },
    { t: H + W, p: [r.xMax, r.zMax] },
    { t: 2 * H + W, p: [r.xMax, r.zMin] },
    { t: per, p: [r.xMin, r.zMin] }
  ];
  const out: Vec2[] = [];
  let cursor = ta;
  while (true) {
    let best: { t: number; p: Vec2 } | null = null;
    let bestT = Infinity;
    for (const c of corners) {
      for (const tt of [c.t, c.t + per]) {
        if (tt > cursor + 1e-6 && tt < tb - 1e-6 && tt < bestT) { bestT = tt; best = { t: tt, p: c.p }; }
      }
    }
    if (!best) break;
    out.push(best.p);
    cursor = best.t;
  }
  out.push(to);
  return out;
}

function pushUnique(out: Vec2[], p: Vec2) {
  if (!out.length || dist2(p[0], p[1], out[out.length - 1][0], out[out.length - 1][1]) > 0.0025) out.push(p);
}

function boundaryCW(from: Vec2, to: Vec2, r: Rect): Vec2[] {
  const H = r.zMax - r.zMin;
  const W = r.xMax - r.xMin;
  const per = 2 * (H + W);
  let ta = edgeParamCW(from, r);
  let tb = edgeParamCW(to, r);
  if (tb <= ta + 1e-6) tb += per;
  const corners: Array<{ t: number; p: Vec2 }> = [
    { t: H, p: [r.xMax, r.zMax] },
    { t: H + W, p: [r.xMin, r.zMax] },
    { t: 2 * H + W, p: [r.xMin, r.zMin] },
    { t: per, p: [r.xMax, r.zMin] }
  ];
  const out: Vec2[] = [];
  let cursor = ta;
  while (true) {
    let best: { t: number; p: Vec2 } | null = null;
    let bestT = Infinity;
    for (const c of corners) {
      for (const tt of [c.t, c.t + per]) {
        if (tt > cursor + 1e-6 && tt < tb - 1e-6 && tt < bestT) { bestT = tt; best = { t: tt, p: c.p }; }
      }
    }
    if (!best) break;
    out.push(best.p);
    cursor = best.t;
  }
  out.push(to);
  return out;
}

function edgeParamCW(p: Vec2, r: Rect): number {
  const H = r.zMax - r.zMin;
  const W = r.xMax - r.xMin;
  const dE = Math.abs(p[0] - r.xMax);
  const dS = Math.abs(p[1] - r.zMax);
  const dW = Math.abs(p[0] - r.xMin);
  const dN = Math.abs(p[1] - r.zMin);
  const m = Math.min(dE, dS, dW, dN);
  if (m === dE) return Math.max(0, Math.min(H, p[1] - r.zMin));
  if (m === dS) return H + Math.max(0, Math.min(W, r.xMax - p[0]));
  if (m === dW) return H + W + Math.max(0, Math.min(H, r.zMax - p[1]));
  return 2 * H + W + Math.max(0, Math.min(W, p[0] - r.xMin));
}

export interface CoastTopology {
  water: Vec2[][];
  islets: Vec2[][];
}

export function buildCoastTopology(chains: CoastChain[]): CoastTopology {
  const r = LOCAL_BOUNDS;
  const islets: Vec2[][] = [];
  const pieces: Vec2[][] = [];

  for (const chain of chains) {
    if (chain.closed) {
      if (chain.pts.length > 6 && Math.abs(polygonArea(chain.pts)) > 150) islets.push(chain.pts);
      continue;
    }
    for (const piece of clipPolylineToBounds(chain.pts, r)) if (piece.length > 1) pieces.push(piece);
  }

  const water: Vec2[][] = [];
  if (pieces.length < 2) return { water, islets };

  const lengthOf = (pts: Vec2[]) => {
    let l = 0;
    for (let i = 0; i < pts.length - 1; i++) l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    return l;
  };

  const seaCoast = pieces.reduce((a, b) => (lengthOf(a) >= lengthOf(b) ? a : b));
  const others = pieces.filter((p) => p !== seaCoast);
  const bayCoast = others.reduce((a, b) => {
    const za = a.reduce((s, p) => s + p[1], 0) / a.length;
    const zb = b.reduce((s, p) => s + p[1], 0) / b.length;
    return za <= zb ? a : b;
  }, others[0]);

  const sea: Vec2[] = [];
  for (const p of seaCoast) pushUnique(sea, p);
  for (const p of boundaryCW(seaCoast[seaCoast.length - 1], seaCoast[0], r)) pushUnique(sea, p);
  if (Math.abs(polygonArea(sea)) > 1000) water.push(sea);

  if (bayCoast) {
    let maxX = -Infinity, idxA2 = 0;
    bayCoast.forEach((p, i) => { if (p[0] > maxX) { maxX = p[0]; idxA2 = i; } });
    const a2 = bayCoast[idxA2];
    let best = Infinity, idxB = 0;
    seaCoast.forEach((p, i) => {
      const d = dist2(p[0], p[1], a2[0], a2[1]);
      if (d < best) { best = d; idxB = i; }
    });
    const bHead = seaCoast[idxB];
    const bay: Vec2[] = [];
    for (let i = bayCoast.length - 1; i >= idxA2; i--) pushUnique(bay, bayCoast[i]);
    pushUnique(bay, a2);
    pushUnique(bay, bHead);
    for (let i = idxB; i >= 0; i--) pushUnique(bay, seaCoast[i]);
    pushUnique(bay, seaCoast[0]);
    for (const p of boundaryCW(seaCoast[0], bayCoast[bayCoast.length - 1], r)) pushUnique(bay, p);
    if (Math.abs(polygonArea(bay)) > 1000) water.push(bay);
  }

  return { water, islets };
}

export function bboxRing(): Vec2[] {
  const r = LOCAL_BOUNDS;
  return [[r.xMin, r.zMin], [r.xMax, r.zMin], [r.xMax, r.zMax], [r.xMin, r.zMax]];
}

interface Hill { x: number; z: number; add: number; radius: number }

export const HILLS: Hill[] = [
  { lon: 120.32636, lat: 36.06675, add: 92, radius: 240 },
  { lon: 120.32268, lat: 36.06961, add: 74, radius: 220 },
  { lon: 120.32819, lat: 36.06967, add: 80, radius: 230 },
  { lon: 120.32019, lat: 36.06694, add: 61, radius: 175 },
  { lon: 120.33163, lat: 36.05873, add: 54, radius: 155 },
  { lon: 120.33495, lat: 36.06276, add: 58, radius: 200 },
  { lon: 120.31845, lat: 36.05234, add: 12, radius: 170 }
].map((h) => {
  const p = project(h.lon, h.lat);
  return { x: p[0], z: p[1], add: h.add, radius: h.radius };
});

export interface DemGrid {
  xMin: number;
  zMin: number;
  xMax: number;
  zMax: number;
  cell: number;
  cols: number;
  rows: number;
  scale: number;
  data: Int16Array;
}

let DEM: DemGrid | null = null;

export function setDemGrid(grid: DemGrid) {
  DEM = grid;
}

export function getDemGrid(): DemGrid | null {
  return DEM;
}

const ISLET_BUMPS = [
  { lon: 120.3187, lat: 36.0530, add: 14.5, radius: 95 }
].map((b) => {
  const p = project(b.lon, b.lat);
  return { x: p[0], z: p[1], add: b.add, radius: b.radius };
});

export const SEA_LEVEL = 0;
export const LAND_BASE = 3.4;
export const PIER_Y = 3.25;

export function terrainHeight(x: number, z: number): number {
  let h: number;

  if (DEM) {
    const fx = (x - DEM.xMin) / DEM.cell;
    const fz = (z - DEM.zMin) / DEM.cell;
    if (fx >= 0 && fz >= 0 && fx < DEM.cols - 1 && fz < DEM.rows - 1) {
      const i0 = Math.floor(fx), j0 = Math.floor(fz);
      const tx = fx - i0, tz = fz - j0;
      const idx = j0 * DEM.cols + i0;
      const a = DEM.data[idx];
      const b = DEM.data[idx + 1];
      const c = DEM.data[idx + DEM.cols];
      const d = DEM.data[idx + DEM.cols + 1];
      const raw = (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
      h = raw / DEM.scale;
    } else {
      h = LAND_BASE;
    }
  } else {
    h = LAND_BASE;
    for (const hill of HILLS) {
      const dx = x - hill.x;
      const dz = z - hill.z;
      const s = hill.radius / 1.85;
      h += hill.add * Math.exp(-(dx * dx + dz * dz) / (2 * s * s));
    }
    h += 12 * Math.exp(-(x * x + (z + 1500) * (z + 1500)) / (2 * 700 * 700));
    h += Math.sin(x * 0.013) * Math.cos(z * 0.011) * 0.9;
    h += Math.sin(x * 0.047 + z * 0.036) * 0.35;
  }

  for (const b of ISLET_BUMPS) {
    const dx = x - b.x;
    const dz = z - b.z;
    h += b.add * Math.exp(-(dx * dx + dz * dz) / (2 * b.radius * b.radius));
  }

  return Math.max(0.55, h);
}

export function isPointInRingSet(x: number, z: number, rings: Vec2[][]): boolean {
  for (const ring of rings) if (pointInPolygon(x, z, ring)) return true;
  return false;
}

export function distanceToRing(x: number, z: number, ring: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + dx * t, pz = a[1] + dz * t;
    best = Math.min(best, Math.sqrt(dist2(x, z, px, pz)));
  }
  return best;
}
