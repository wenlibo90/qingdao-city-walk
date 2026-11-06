import * as THREE from 'three';
import earcut from 'earcut';
import type { WorldData } from '../world/loadWorld';
import { LOCAL_BOUNDS, clipPolylineToBounds, terrainHeight, type Vec2 } from '../core/geo';
import { MeshBuilder } from './meshBuilder';

const WIDTHS: Record<string, number> = {
  trunk: 18, trunk_link: 12,
  primary: 15, primary_link: 12,
  secondary: 12, secondary_link: 10,
  tertiary: 10, tertiary_link: 8,
  residential: 8,
  living_street: 7,
  unclassified: 8,
  service: 5,
  pedestrian: 9,
  footway: 2.6,
  path: 2,
  steps: 2.4,
  cycleway: 3,
  track: 3.5,
  busway: 8
};

const TYPE: Record<string, number> = {
  footway: 0, path: 0, steps: 0, cycleway: 0, track: 0,
  service: 1, residential: 1, living_street: 1, unclassified: 1,
  tertiary: 2, tertiary_link: 2,
  secondary: 3, secondary_link: 3, primary: 3, primary_link: 3, trunk: 3, trunk_link: 3,
  pedestrian: 4,
  busway: 1
};

const TYPES = { aType: 'float', aSeed: 'float' } as const;

interface Sample { x: number; z: number; v: number; nx: number; nz: number; }

function resample(points: Vec2[], step = 5): Sample[] {
  const out: Sample[] = [];
  let v = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push({ x: a[0] + dx * t, z: a[1] + dz * t, v: v + len * t, nx: dx / len, nz: dz / len });
    }
    v += len;
  }
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const dx = last[0] - prev[0], dz = last[1] - prev[1];
  const len = Math.hypot(dx, dz) || 1;
  out.push({ x: last[0], z: last[1], v, nx: dx / len, nz: dz / len });
  return out;
}

export function generateRoads(data: WorldData): THREE.BufferGeometry | null {
  const mb = new MeshBuilder(TYPES);
  const roadRect = {
    xMin: LOCAL_BOUNDS.xMin - 35,
    xMax: LOCAL_BOUNDS.xMax + 35,
    zMin: LOCAL_BOUNDS.zMin - 35,
    zMax: LOCAL_BOUNDS.zMax + 35
  };

  for (const road of data.roads) {
    const half = (WIDTHS[road.kind] ?? 7) / 2;
    const type = TYPE[road.kind] ?? 1;
    const step = road.kind === 'footway' || road.kind === 'path' || road.kind === 'steps' ? 3 : 6;
    const seed = (road.id % 97) / 97;
    const jitter = ((road.id % 13) - 6) * 0.0025;
    const attr = { aType: type, aSeed: seed };
    const ch = terrainHeight;
    const pieces = clipPolylineToBounds(road.points, roadRect);
    for (const piece of pieces) {
      const samples = resample(piece, step);
      if (samples.length < 2) continue;
      for (let i = 0; i < samples.length - 1; i++) {
        const s0 = samples[i], s1 = samples[i + 1];
        const l0: [number, number] = [s0.x - s0.nz * half, s0.z + s0.nx * half];
        const r0: [number, number] = [s0.x + s0.nz * half, s0.z - s0.nx * half];
        const l1: [number, number] = [s1.x - s1.nz * half, s1.z + s1.nx * half];
        const r1: [number, number] = [s1.x + s1.nz * half, s1.z - s1.nx * half];
        const y0l = ch(l0[0], l0[1]) + 0.11 + jitter;
        const y0r = ch(r0[0], r0[1]) + 0.11 + jitter;
        const y1l = ch(l1[0], l1[1]) + 0.11 + jitter;
        const y1r = ch(r1[0], r1[1]) + 0.11 + jitter;
        const p0: [number, number, number] = [l0[0], y0l, l0[1]];
        const p1: [number, number, number] = [r0[0], y0r, r0[1]];
        const p2: [number, number, number] = [r1[0], y1r, r1[1]];
        const p3: [number, number, number] = [l1[0], y1l, l1[1]];
        const nx = -s0.nz, nz = s0.nx;
        mb.quad(
          p0, p1, p2, p3,
          [-1, s0.v], [1, s0.v], [1, s1.v], [-1, s1.v],
          attr, attr, attr, attr,
          [nx, 0.4, nz]
        );
      }
    }
  }

  for (const ring of data.roadAreas) {
    const flat: number[] = [];
    for (const p of ring) flat.push(p[0], p[1]);
    const tris = earcut(flat);
    const attr = { aType: 4, aSeed: 0.4 };
    const up: [number, number, number] = [0, 1, 0];
    for (let i = 0; i < tris.length; i += 3) {
      const a = ring[tris[i]], b = ring[tris[i + 1]], c = ring[tris[i + 2]];
      const pa: [number, number, number] = [a[0], terrainHeight(a[0], a[1]) + 0.12, a[1]];
      const pb: [number, number, number] = [b[0], terrainHeight(b[0], b[1]) + 0.12, b[1]];
      const pc: [number, number, number] = [c[0], terrainHeight(c[0], c[1]) + 0.12, c[1]];
      mb.tri(pa, pb, pc, [-1, 0], [1, 0], [0, 1], attr, attr, attr, up);
    }
  }

  return mb.build();
}
