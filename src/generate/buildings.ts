import * as THREE from 'three';
import earcut from 'earcut';
import type { BuildingDef, WorldData } from '../world/loadWorld';
import { pointInPolygon, terrainHeight, PIER_Y, type Vec2 } from '../core/geo';
import { MeshBuilder } from './meshBuilder';

export interface Collider {
  ring: Vec2[];
  holes: Vec2[][];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

export interface BuildingResult {
  chunks: Map<string, THREE.BufferGeometry>;
  colliders: Collider[];
  extras: THREE.Object3D[];
}

interface Palette { wall: string; roof: string; }

const WALL_PALETTE = ['#d8cbb3', '#cbb79a', '#bda98f', '#c9c3b6', '#e2dccb', '#b5896f', '#c99c7e', '#d2c09a'];
const RED_ROOFS = ['#a9472f', '#b55436', '#963d2b', '#c0613f', '#a04b33', '#8f3d2d'];
const GRAY_ROOFS = ['#6f6d66', '#5b5a55', '#7d7a70', '#565049', '#837c6e'];

const hash01 = (n: number) => {
  const x = Math.sin(n * 12.9898 + 4.1414) * 43758.5453;
  return x - Math.floor(x);
};

const typeHeight: Record<string, number> = {
  house: 8.2,
  residential: 12,
  apartments: 27,
  commercial: 19,
  hotel: 18,
  school: 12,
  university: 14,
  hospital: 20,
  church: 15,
  kindergarten: 8,
  yes: 10
};

function parseNum(v?: string): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function describe(b: BuildingDef): { body: number; gable: boolean; wall: string; roof: string; red: boolean } {
  const t = b.tags;
  const type = t.building ?? 'yes';
  const rnd = hash01(b.id);
  const rnd2 = hash01(b.id + 17);
  const oldTown = (b.centroid[1] > -1050 && b.centroid[1] < 560 && b.centroid[0] < 760)
    || (b.centroid[0] > 2250 && b.centroid[0] < 4700 && b.centroid[1] > 250 && b.centroid[1] < 1700);

  let body = parseNum(t.height);
  if (body == null) {
    const levels = parseNum(t['building:levels']);
    if (levels != null) body = levels * 3.25 + 1.1;
  }
  if (body == null) {
    const base = typeHeight[type] ?? 10;
    body = base * (0.82 + rnd * 0.45);
    if (oldTown && (type === 'yes' || type === 'house' || type === 'residential')) body = 7.2 + rnd * 5.2;
    if (type === 'apartments' && oldTown) body = 14 + rnd * 12;
  }

  let wall = WALL_PALETTE[Math.floor(rnd2 * WALL_PALETTE.length)];
  if (t['building:colour']) wall = t['building:colour'];

  let red = oldTown ? hash01(b.id + 5.7) < 0.82 : hash01(b.id + 5.7) < 0.32;
  let roof = red
    ? RED_ROOFS[Math.floor(hash01(b.id + 9.1) * RED_ROOFS.length)]
    : GRAY_ROOFS[Math.floor(hash01(b.id + 9.1) * GRAY_ROOFS.length)];

  const name = b.name;
  if (name.includes('圣弥爱尔') || name.includes('天主教堂')) {
    body = 24; wall = '#e9d3ba'; roof = '#d9775e'; red = true;
  } else if (name.includes('回澜阁')) {
    body = 6.2; wall = '#cf534f'; roof = '#e6ac6b'; red = true;
  } else if (name.includes('天后宫')) {
    body = 10; wall = '#a94a3c'; roof = '#6f4a3a'; red = true;
  } else if (name.includes('总督府')) {
    body = 14.5; wall = '#d8c9a8'; roof = '#a9472f'; red = true;
  } else if (name.includes('总督楼') || name.includes('迎宾馆')) {
    body = 14; wall = '#c9b58e'; roof = '#9c4630'; red = true;
  } else if (name.includes('圣保罗堂')) {
    body = 16; wall = '#b9b2a4'; roof = '#5d5a52'; red = false;
  } else if (name.includes('基督教堂')) {
    body = 15; wall = '#d9cbb2'; roof = '#7a4b35'; red = true;
  } else if (name.includes('观象台')) {
    body = 13; wall = '#e3e0d6'; roof = '#6c6a63'; red = false;
  } else if (name.includes('水族馆')) {
    body = 12; wall = '#cfc6b3'; roof = '#5f6a63'; red = false;
  }

  if (t['roof:colour']) roof = t['roof:colour'];
  if (t['building:colour']) wall = t['building:colour'];

  body = Math.max(5.5, Math.min(70, body));

  const width = Math.sqrt(b.area);
  let gable = red && body <= 26 && width < 34 && type !== 'apartments' && type !== 'commercial' && type !== 'school' && hash01(b.id + 31) < 0.9;
  if (name.includes('圣弥爱尔') || name.includes('回澜阁')) gable = false;
  if (name.includes('圣保罗堂') || name.includes('基督教堂')) gable = false;
  return { body, gable, wall, roof, red };
}

function palette(color: THREE.ColorRepresentation): [number, number, number] {
  const c = new THREE.Color(color);
  return [c.r, c.g, c.b];
}

interface OrientedFrame { cx: number; cz: number; ux: number; uz: number; vx: number; vz: number; uMin: number; uMax: number; vMin: number; vMax: number; }

function orientedFrame(ring: Vec2[]): OrientedFrame {
  let cx = 0, cz = 0;
  for (const p of ring) { cx += p[0]; cz += p[1]; }
  cx /= ring.length; cz /= ring.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const p of ring) {
    const dx = p[0] - cx, dz = p[1] - cz;
    sxx += dx * dx; szz += dz * dz; sxz += dx * dz;
  }
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(angle), uz = Math.sin(angle);
  const vx = -uz, vz = ux;
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const p of ring) {
    const dx = p[0] - cx, dz = p[1] - cz;
    const u = dx * ux + dz * uz;
    const v = dx * vx + dz * vz;
    uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
    vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
  }
  return { cx, cz, ux, uz, vx, vz, uMin, uMax, vMin, vMax };
}

function worldPoint(f: OrientedFrame, u: number, v: number, y: number): [number, number, number] {
  return [f.cx + f.ux * u + f.vx * v, y, f.cz + f.uz * u + f.vz * v];
}

function chunkKey(x: number, z: number): string {
  return `${Math.floor(x / 420)}_${Math.floor(z / 420)}`;
}

function addHipRoof(
  mb: MeshBuilder,
  frame: OrientedFrame,
  topY: number,
  roofH: number,
  attr: Record<string, number | [number, number, number]>,
  uvOf: (p: [number, number, number]) => [number, number]
) {
  const o = 0.55;
  const uMin = frame.uMin - o, uMax = frame.uMax + o;
  const vMin = frame.vMin - o, vMax = frame.vMax + o;
  const vMid = (vMin + vMax) / 2;
  const inset = Math.min((vMax - vMin) * 0.55, (uMax - uMin) * 0.26);
  const r1 = worldPoint(frame, uMin + inset, vMid, topY + roofH);
  const r2 = worldPoint(frame, uMax - inset, vMid, topY + roofH);
  const e1 = worldPoint(frame, uMin, vMin, topY);
  const e2 = worldPoint(frame, uMax, vMin, topY);
  const e3 = worldPoint(frame, uMax, vMax, topY);
  const e4 = worldPoint(frame, uMin, vMax, topY);
  const up: [number, number, number] = [0, 1, 0];
  mb.quad(e1, e2, r2, r1, uvOf(e1), uvOf(e2), uvOf(r2), uvOf(r1), attr, attr, attr, attr, up);
  mb.quad(e4, e3, r2, r1, uvOf(e4), uvOf(e3), uvOf(r2), uvOf(r1), attr, attr, attr, attr, up);
  mb.tri(e1, e4, r1, uvOf(e1), uvOf(e4), uvOf(r1), attr, attr, attr, up);
  mb.tri(e2, e3, r2, uvOf(e2), uvOf(e3), uvOf(r2), attr, attr, attr, up);
}

function addFlatRoof(mb: MeshBuilder, ring: Vec2[], holes: Vec2[][], y: number, attr: Record<string, number | [number, number, number]>) {
  const rings = [ring, ...holes];
  const flat: number[] = [];
  const holeIndices: number[] = [];
  for (let i = 0; i < rings.length; i++) {
    if (i > 0) holeIndices.push(flat.length / 2);
    for (const p of rings[i]) flat.push(p[0], p[1]);
  }
  const all: Vec2[] = [];
  for (let i = 0; i < flat.length; i += 2) all.push([flat[i], flat[i + 1]]);
  const tris = earcut(flat, holeIndices);
  const uvOf = (p: [number, number, number]): [number, number] => [p[0] * 0.5, p[2] * 0.5];
  const up: [number, number, number] = [0, 1, 0];
  for (let i = 0; i < tris.length; i += 3) {
    const a = all[tris[i]], b = all[tris[i + 1]], c = all[tris[i + 2]];
    const pa: [number, number, number] = [a[0], y, a[1]];
    const pb: [number, number, number] = [b[0], y, b[1]];
    const pc: [number, number, number] = [c[0], y, c[1]];
    mb.tri(pa, pb, pc, uvOf(pa), uvOf(pb), uvOf(pc), attr, attr, attr, up);
  }
}

function addBox(
  mb: MeshBuilder,
  x: number, z: number, baseY: number, w: number, d: number, h: number,
  attr: Record<string, number | [number, number, number]>,
  rot = 0
) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const corners: Array<[number, number]> = [
    [-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]
  ].map(([x0, z0]) => [x + x0 * c - z0 * s, z + x0 * s + z0 * c]);
  const top = baseY + h;
  const uv = (p: [number, number, number]): [number, number] => [p[0] * 0.5, p[2] * 0.5];
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    const nx = b[1] - a[1], nz = -(b[0] - a[0]);
    const p0: [number, number, number] = [a[0], baseY, a[1]];
    const p1: [number, number, number] = [b[0], baseY, b[1]];
    const p2: [number, number, number] = [b[0], top, b[1]];
    const p3: [number, number, number] = [a[0], top, a[1]];
    mb.quad(p0, p1, p2, p3, uv(p0), uv(p1), uv(p2), uv(p3), attr, attr, attr, attr, [nx, 0, nz]);
  }
  const up: [number, number, number] = [0, 1, 0];
  const capAttr = { ...attr, aPart: 1 };
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    const pa: [number, number, number] = [a[0], top, a[1]];
    const pb: [number, number, number] = [b[0], top, b[1]];
    mb.tri([x, top, z], pa, pb, [x * 0.5, z * 0.5], uv(pa), uv(pb), capAttr, capAttr, capAttr, up);
  }
}

function addPyramidSpire(
  mb: MeshBuilder,
  x: number, z: number, baseY: number, radius: number, h: number,
  attr: Record<string, number | [number, number, number]>
) {
  const seg = 4;
  const apex: [number, number, number] = [x, baseY + h, z];
  const ring: Array<[number, number, number]> = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2 + Math.PI / 4;
    ring.push([x + Math.cos(a) * radius, baseY, z + Math.sin(a) * radius]);
  }
  for (let i = 0; i < seg; i++) {
    const a = ring[i], b = ring[(i + 1) % seg];
    mb.tri(a, b, apex, [a[0] * 0.5, a[2] * 0.5], [b[0] * 0.5, b[2] * 0.5], [apex[0] * 0.5, apex[2] * 0.5], attr, attr, attr, [0, 1, 0]);
  }
}

function addOctagonalRoof(
  mb: MeshBuilder,
  x: number, z: number, baseY: number, radius: number, h: number,
  attr: Record<string, number | [number, number, number]>
) {
  const seg = 8;
  const apex: [number, number, number] = [x, baseY + h, z];
  const ring: Array<[number, number, number]> = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    ring.push([x + Math.cos(a) * radius, baseY + Math.sin(i * 1.7) * 0.1, z + Math.sin(a) * radius]);
  }
  for (let i = 0; i < seg; i++) {
    const a = ring[i], b = ring[(i + 1) % seg];
    mb.tri(a, b, apex, [a[0] * 0.5, a[2] * 0.5], [b[0] * 0.5, b[2] * 0.5], [apex[0] * 0.5, apex[2] * 0.5], attr, attr, attr, [0, 1, 0]);
  }
}

export function generateBuildings(data: WorldData): BuildingResult {
  const chunks = new Map<string, MeshBuilder>();
  const colliders: Collider[] = [];
  const extras: THREE.Object3D[] = [];

  const getBuilder = (key: string) => {
    let mb = chunks.get(key);
    if (!mb) {
      mb = new MeshBuilder({ aSeed: 'float', aFacade: 'vec3', aRoof: 'vec3', aPart: 'float', aHeight: 'float' });
      chunks.set(key, mb);
    }
    return mb;
  };

  for (const b of data.buildings) {
    const info = describe(b);
    const name = b.name;
    if (name.includes('小青岛灯塔')) continue;
    if (Number(b.tags._id) === 20812582) continue;
    if (b.area < 7 || b.ring.length < 3) continue;

    let base = Infinity;
    for (const ring of [b.ring, ...b.holes]) {
      for (const p of ring) base = Math.min(base, terrainHeight(p[0], p[1]));
    }
    base -= 0.7;
    let onPier = false;
    for (const pier of data.piers) {
      if (pointInPolygon(b.centroid[0], b.centroid[1], pier)) { base = PIER_Y - 0.15; onPier = true; break; }
    }
    if (onPier) base = PIER_Y - 0.12;

    const key = chunkKey(b.centroid[0], b.centroid[1]);
    const mb = getBuilder(key);
    const seed = hash01(b.id + 3.3);
    const wallColor = palette(info.wall);
    const roofColor = palette(info.roof);
    const wallAttr = { aSeed: seed, aFacade: wallColor, aRoof: roofColor, aPart: 0, aHeight: info.body };
    const roofAttr = { aSeed: seed, aFacade: wallColor, aRoof: roofColor, aPart: 1, aHeight: info.body };

    const topY = base + info.body;
    const addWall = (ring: Vec2[], hole: Vec2[] | null) => {
      let perim = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length];
        const dx = c[0] - a[0], dz = c[1] - a[1];
        const len = Math.hypot(dx, dz);
        if (len < 0.2) continue;
        let nx = dz / len, nz = -dx / len;
        const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
        const sx = mx + nx * 0.3, sz = mz + nz * 0.3;
        if (hole) {
          if (!pointInPolygon(sx, sz, hole)) { nx = -nx; nz = -nz; }
        } else {
          const inside = pointInPolygon(sx, sz, b.ring);
          const inHole = b.holes.some((h) => pointInPolygon(sx, sz, h));
          if (inside && !inHole) { nx = -nx; nz = -nz; }
        }
        const p0: [number, number, number] = [a[0], base, a[1]];
        const p1: [number, number, number] = [c[0], base, c[1]];
        const p2: [number, number, number] = [c[0], topY, c[1]];
        const p3: [number, number, number] = [a[0], topY, a[1]];
        mb.quad(
          p0, p1, p2, p3,
          [perim, 0], [perim + len, 0], [perim + len, info.body], [perim, info.body],
          wallAttr, wallAttr, wallAttr, wallAttr,
          [nx, 0, nz]
        );
        perim += len;
      }
    };

    addWall(b.ring, null);
    for (const hole of b.holes) addWall(hole, hole);

    const frame = orientedFrame(b.ring);
    const spanU = frame.uMax - frame.uMin;
    const spanV = frame.vMax - frame.vMin;
    const fill = spanU > 0 && spanV > 0 ? Math.min(1, b.area / (spanU * spanV)) : 0;
    const canGable = b.holes.length === 0 && info.gable && spanU < 48 && spanV < 34 && Math.min(spanU, spanV) > 3 && fill > 0.52;
    if (canGable) {
      const roofH = Math.min(4.8, Math.max(1.7, spanV * 0.32));
      addHipRoof(mb, frame, topY, roofH, roofAttr, (p) => [p[0] * 0.5, p[2] * 0.5]);
    } else {
      addFlatRoof(mb, b.ring, b.holes, topY, roofAttr);
    }

    if (name.includes('圣弥爱尔') || name.includes('天主教堂')) {
      const span = frame.uMax - frame.uMin;
      const towerH = 34;
      for (const u of [frame.uMin + span * 0.17, frame.uMax - span * 0.17]) {
        const p = worldPoint(frame, u, (frame.vMin + frame.vMax) / 2, base);
        addBox(mb, p[0], p[2], base, 6.4, 6.4, towerH, wallAttr, 0);
        addPyramidSpire(mb, p[0], p[2], base + towerH, 4.6, 8.5, roofAttr);
        addBox(mb, p[0], p[2], base + towerH + 8.5, 0.7, 0.7, 2.4, wallAttr, 0);
      }
    }

    if (name.includes('回澜阁')) {
      addOctagonalRoof(mb, b.centroid[0], b.centroid[1], topY, 7.2, 5.2, roofAttr);
    }

    if (name.includes('圣保罗堂') || name.includes('基督教堂')) {
      const p = worldPoint(frame, frame.uMin + 2.2, frame.vMin + 2.2, base);
      addBox(mb, p[0], p[2], base, 4.8, 4.8, info.body + 8, wallAttr, 0);
      addPyramidSpire(mb, p[0], p[2], base + info.body + 8, 3.4, 6, roofAttr);
    }

    colliders.push({
      ring: b.ring,
      holes: b.holes,
      minX: Math.min(...b.ring.map((p) => p[0])),
      maxX: Math.max(...b.ring.map((p) => p[0])),
      minZ: Math.min(...b.ring.map((p) => p[1])),
      maxZ: Math.max(...b.ring.map((p) => p[1])),
      height: info.body
    });
  }

  for (const s of data.ships) {
    const mb = getBuilder(chunkKey(s.centroid[0], s.centroid[1]));
    const attr = { aSeed: 0.5, aFacade: palette('#59606a'), aRoof: palette('#3b4148'), aPart: 0, aHeight: 5.5 };
    const base = 0.2;
    for (let i = 0; i < s.ring.length; i++) {
      const a = s.ring[i], b = s.ring[(i + 1) % s.ring.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.2) continue;
      const p0: [number, number, number] = [a[0], base, a[1]];
      const p1: [number, number, number] = [b[0], base, b[1]];
      const p2: [number, number, number] = [b[0], base + 5.5, b[1]];
      const p3: [number, number, number] = [a[0], base + 5.5, a[1]];
      mb.quad(p0, p1, p2, p3, [0, 0], [len, 0], [len, 5.5], [0, 5.5], attr, attr, attr, attr, [dz, 0, -dx]);
    }
    addFlatRoof(mb, s.ring, [], base + 5.5, { ...attr, aPart: 1 });
  }

  const geometries = new Map<string, THREE.BufferGeometry>();
  for (const [key, mb] of chunks) {
    const geo = mb.build();
    if (geo) geometries.set(key, geo);
  }

  return { chunks: geometries, colliders, extras };
}
