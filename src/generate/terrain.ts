import * as THREE from 'three';
import earcut from 'earcut';
import type { GreenDef } from '../world/loadWorld';
import { LOCAL_BOUNDS, PIER_Y, pointInPolygon, terrainHeight, type Vec2 } from '../core/geo';
import { MeshBuilder } from './meshBuilder';

interface IndexedBuild {
  positions: number[];
  indices: number[];
  map: Map<string, number>;
}

function vertexKey(x: number, z: number): string {
  return `${Math.round(x * 40)}:${Math.round(z * 40)}`;
}

function addVertex(build: IndexedBuild, x: number, z: number, y: number): number {
  const key = vertexKey(x, z);
  const existing = build.map.get(key);
  if (existing !== undefined) return existing;
  const idx = build.positions.length / 3;
  build.positions.push(x, y, z);
  build.map.set(key, idx);
  return idx;
}

function subdivide(
  build: IndexedBuild,
  a: Vec2, b: Vec2, c: Vec2,
  yFn: (x: number, z: number) => number,
  maxEdge: number,
  depth = 0,
  budget = { count: 0 }
) {
  budget.count++;
  const ab = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  const bc = (b[0] - c[0]) ** 2 + (b[1] - c[1]) ** 2;
  const ca = (c[0] - a[0]) ** 2 + (c[1] - a[1]) ** 2;
  const maxSq = Math.max(ab, bc, ca);
  if (maxSq > maxEdge * maxEdge && depth < 16 && budget.count < 200000) {
    let p: Vec2, q: Vec2, r: Vec2;
    if (maxSq === ab) {
      const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      subdivide(build, a, m, c, yFn, maxEdge, depth + 1, budget);
      subdivide(build, m, b, c, yFn, maxEdge, depth + 1, budget);
      return;
    } else if (maxSq === bc) {
      const m: Vec2 = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
      subdivide(build, a, b, m, yFn, maxEdge, depth + 1, budget);
      subdivide(build, a, m, c, yFn, maxEdge, depth + 1, budget);
      return;
    } else {
      const m: Vec2 = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
      subdivide(build, a, b, m, yFn, maxEdge, depth + 1, budget);
      subdivide(build, m, b, c, yFn, maxEdge, depth + 1, budget);
      return;
    }
  }

  const crossY = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
  if (crossY < 0) { const t = b; b = c; c = t; }
  const ia = addVertex(build, a[0], a[1], yFn(a[0], a[1]));
  const ib = addVertex(build, b[0], b[1], yFn(b[0], b[1]));
  const ic = addVertex(build, c[0], c[1], yFn(c[0], c[1]));
  build.indices.push(ia, ib, ic);
}

export function generateTerrain(outer: Vec2[], holes: Vec2[][], islets: Vec2[][]): THREE.BufferGeometry {
  const build: IndexedBuild = { positions: [], indices: [], map: new Map() };
  const yFn = (x: number, z: number) => terrainHeight(x, z);
  const rings = [outer, ...holes];
  const flat: number[] = [];
  const holeIndices: number[] = [];
  for (let i = 0; i < rings.length; i++) {
    if (i > 0) holeIndices.push(flat.length / 2);
    for (const p of rings[i]) flat.push(p[0], p[1]);
  }
  const verts: Vec2[] = [];
  for (let i = 0; i < flat.length; i += 2) verts.push([flat[i], flat[i + 1]]);
  const tris = earcut(flat, holeIndices);
  for (let i = 0; i < tris.length; i += 3) {
    const budget = { count: 0 };
    subdivide(build, verts[tris[i]], verts[tris[i + 1]], verts[tris[i + 2]], yFn, 52, 0, budget);
  }
  for (const ring of islets) {
    const f: number[] = [];
    for (const p of ring) f.push(p[0], p[1]);
    const t = earcut(f);
    const b = { count: 0 };
    for (let i = 0; i < t.length; i += 3) {
      subdivide(build, ring[t[i]], ring[t[i + 1]], ring[t[i + 2]], yFn, 28, 0, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(build.positions, 3));
  geo.setIndex(build.indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export function generateCoastSkirt(coast: Vec2[][]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const bottom = -2.5;
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
  };
  for (const piece of coast) {
    for (let i = 0; i < piece.length - 1; i++) {
      const a = piece[i], b = piece[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      const r = LOCAL_BOUNDS;
      const aOnEdge = Math.abs(a[0] - r.xMin) < 0.5 || Math.abs(a[0] - r.xMax) < 0.5 || Math.abs(a[1] - r.zMin) < 0.5 || Math.abs(a[1] - r.zMax) < 0.5;
      const bOnEdge = Math.abs(b[0] - r.xMin) < 0.5 || Math.abs(b[0] - r.xMax) < 0.5 || Math.abs(b[1] - r.zMin) < 0.5 || Math.abs(b[1] - r.zMax) < 0.5;
      if (aOnEdge && bOnEdge) continue;
      const nx = dz / len, nz = -dx / len;
      const ya = terrainHeight(a[0], a[1]) + 0.05;
      const yb = terrainHeight(b[0], b[1]) + 0.05;
      const p0: [number, number, number] = [a[0], bottom, a[1]];
      const p1: [number, number, number] = [b[0], bottom, b[1]];
      const p2: [number, number, number] = [b[0], yb, b[1]];
      const p3: [number, number, number] = [a[0], ya, a[1]];
      push(...p0, nx, 0.1, nz);
      push(...p1, nx, 0.1, nz);
      push(...p2, nx, 0.1, nz);
      push(...p0, nx, 0.1, nz);
      push(...p2, nx, 0.1, nz);
      push(...p3, nx, 0.1, nz);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.computeBoundingSphere();
  return geo;
}

function surfaceGeometry(rings: Vec2[][], yFn: (x: number, z: number) => number, maxEdge: number): THREE.BufferGeometry {
  const build: IndexedBuild = { positions: [], indices: [], map: new Map() };
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const flat: number[] = [];
    for (const p of ring) flat.push(p[0], p[1]);
    const tris = earcut(flat);
    const budget = { count: 0 };
    for (let i = 0; i < tris.length; i += 3) {
      subdivide(build, ring[tris[i]], ring[tris[i + 1]], ring[tris[i + 2]], yFn, maxEdge, 0, budget);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(build.positions, 3));
  geo.setIndex(build.indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

export function generateGreens(greens: GreenDef[]): THREE.BufferGeometry {
  const rings = greens.map((g) => g.ring);
  return surfaceGeometry(rings, (x, z) => terrainHeight(x, z) + 0.09, 42);
}

export function generateBeaches(beaches: Vec2[][]): THREE.BufferGeometry {
  return surfaceGeometry(beaches, (x, z) => Math.max(0.35, terrainHeight(x, z) * 0.35 + 0.35), 36);
}

export function generatePierDecks(piers: Vec2[][]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
  };
  for (const ring of piers) {
    const flat: number[] = [];
    for (const p of ring) flat.push(p[0], p[1]);
    const tris = earcut(flat);
    for (let i = 0; i < tris.length; i += 3) {
      const a = ring[tris[i]], b = ring[tris[i + 1]], c = ring[tris[i + 2]];
      const pa: [number, number, number] = [a[0], PIER_Y, a[1]];
      const pb: [number, number, number] = [b[0], PIER_Y, b[1]];
      const pc: [number, number, number] = [c[0], PIER_Y, c[1]];
      const crossY = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]);
      const order = crossY < 0 ? [pa, pc, pb] : [pa, pb, pc];
      for (const p of order) push(p[0], p[1], p[2], 0, 1, 0, p[0] * 0.35, p[2] * 0.35);
    }
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.4) continue;
      const nx = dz / len, nz = -dx / len;
      const p0: [number, number, number] = [a[0], PIER_Y - 0.55, a[1]];
      const p1: [number, number, number] = [b[0], PIER_Y - 0.55, b[1]];
      const p2: [number, number, number] = [b[0], PIER_Y + 0.58, b[1]];
      const p3: [number, number, number] = [a[0], PIER_Y + 0.58, a[1]];
      push(...p0, nx, 0, nz, 0, 0);
      push(...p1, nx, 0, nz, 1, 0);
      push(...p2, nx, 0, nz, 1, 1);
      push(...p0, nx, 0, nz, 0, 0);
      push(...p2, nx, 0, nz, 1, 1);
      push(...p3, nx, 0, nz, 0, 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeBoundingSphere();
  return geo;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function generateTrees(greens: GreenDef[], terrainMaterial: THREE.Material, crownMaterial: THREE.Material): { trunks: THREE.InstancedMesh; crowns: THREE.InstancedMesh } | null {
  const random = rng(20261106);
  const positions: Array<{ x: number; z: number; s: number; r: number }> = [];
  for (const g of greens) {
    const forest = g.kind === 'wood' || g.kind === 'forest';
    const open = g.kind === 'park' || g.kind === 'garden' || g.kind === 'grass' || g.kind === 'meadow' || g.kind === 'scrub';
    if (!forest && !open) continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of g.ring) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]);
    }
    const area = (maxX - minX) * (maxZ - minZ);
    const want = Math.min(80, Math.max(1, Math.round(area / (forest ? 420 : 1050))));
    let placed = 0, tries = 0;
    while (placed < want && tries < want * 18) {
      tries++;
      const x = minX + random() * (maxX - minX);
      const z = minZ + random() * (maxZ - minZ);
      if (!pointInPolygon(x, z, g.ring)) continue;
      positions.push({ x, z, s: 0.75 + random() * 1.05, r: random() * Math.PI * 2 });
      placed++;
      if (positions.length > 2600) break;
    }
    if (positions.length > 2600) break;
  }
  if (!positions.length) return null;

  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.28, 2.2, 5, 1);
  trunkGeo.translate(0, 1.1, 0);
  const crownGeo = new THREE.ConeGeometry(1.65, 3.8, 6, 1);
  crownGeo.translate(0, 3.55, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, terrainMaterial, positions.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMaterial, positions.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  positions.forEach((t, i) => {
    const y = terrainHeight(t.x, t.z) + 0.05;
    q.setFromAxisAngle(up, t.r);
    pos.set(t.x, y, t.z);
    scl.set(t.s, t.s * (0.85 + (i % 7) * 0.03), t.s);
    m.compose(pos, q, scl);
    trunks.setMatrixAt(i, m);
    crowns.setMatrixAt(i, m);
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  trunks.computeBoundingSphere();
  crowns.computeBoundingSphere();
  return { trunks, crowns };
}
