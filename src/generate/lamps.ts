import * as THREE from 'three/webgpu';
import { uNight } from '../materials/shared';
import { vec3 } from 'three/tsl';
import { LOCAL_BOUNDS, PIER_Y, pointInPolygon, terrainHeight, type Vec2 } from '../core/geo';
import type { RoadDef } from '../world/loadWorld';

const LAMP_KINDS = new Set(['trunk', 'primary', 'secondary', 'tertiary']);

function resample(points: Vec2[], step: number): Array<{ x: number; z: number; nx: number; nz: number }> {
  const out: Array<{ x: number; z: number; nx: number; nz: number }> = [];
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.1) continue;
    const nx = dx / len, nz = dz / len;
    let t = acc;
    while (t < acc + len) {
      out.push({ x: a[0] + nx * t, z: a[1] + nz * t, nx, nz });
      t += step;
    }
    acc += len;
  }
  return out;
}

export function generatePierLamps(piers: Vec2[][], anchor: Vec2): { poles: THREE.InstancedMesh; bulbs: THREE.InstancedMesh } | null {
  const ring = piers.find((r) => pointInPolygon(anchor[0], anchor[1], r));
  if (!ring) return null;
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
  const matrices: THREE.Matrix4[] = [];
  const half = (vMax - vMin) / 2;
  void half;
  for (let u = uMin + 10; u < uMax - 26; u += 30) {
    for (const side of [-1, 1]) {
      const v = side * 3.4;
      const x = cx + ux * u + vx * v;
      const z = cz + uz * u + vz * v;
      if (!pointInPolygon(x, z, ring)) continue;
      if ((x + 335.8) * (x + 335.8) + (z - 100) * (z - 100) < 20 * 20) continue;
      const m = new THREE.Matrix4();
      m.makeTranslation(x, PIER_Y, z);
      matrices.push(m);
    }
  }
  if (!matrices.length) return null;
  const poleGeo = new THREE.CylinderGeometry(0.055, 0.08, 3.5, 5, 1);
  poleGeo.translate(0, 1.75, 0);
  const bulbGeo = new THREE.SphereGeometry(0.24, 8, 6);
  bulbGeo.translate(0, 3.55, 0);
  const poleMat = new THREE.MeshStandardNodeMaterial();
  poleMat.color = new THREE.Color('#2c3033');
  poleMat.roughness = 0.8;
  const bulbMat = new THREE.MeshStandardNodeMaterial();
  bulbMat.color = new THREE.Color('#6f6a5a');
  bulbMat.roughness = 0.4;
  bulbMat.emissiveNode = uNight.mul(9.0).mul(vec3(1.0, 0.72, 0.4));
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, matrices.length);
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, matrices.length);
  matrices.forEach((m, i) => { poles.setMatrixAt(i, m); bulbs.setMatrixAt(i, m); });
  poles.instanceMatrix.needsUpdate = true;
  bulbs.instanceMatrix.needsUpdate = true;
  poles.computeBoundingSphere(); bulbs.computeBoundingSphere();
  return { poles, bulbs };
}

export function generateStreetLamps(roads: RoadDef[], isWalkable: (x: number, z: number) => boolean): { poles: THREE.InstancedMesh; bulbs: THREE.InstancedMesh } | null {
  const mats: THREE.Matrix4[] = [];
  const seen = new Set<string>();
  for (const road of roads) {
    if (!LAMP_KINDS.has(road.kind)) continue;
    const offset = road.kind === 'trunk' || road.kind === 'primary' ? 8.5 : 7;
    const pts = resample(road.points, 62);
    for (const p of pts) {
      const x = p.x - p.nz * offset;
      const z = p.z + p.nx * offset;
      if (x < LOCAL_BOUNDS.xMin + 5 || x > LOCAL_BOUNDS.xMax - 5 || z < LOCAL_BOUNDS.zMin + 5 || z > LOCAL_BOUNDS.zMax - 5) continue;
      if (!isWalkable(x, z)) continue;
      const key = `${Math.round(x / 8)}_${Math.round(z / 8)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const y = terrainHeight(x, z);
      const m = new THREE.Matrix4();
      m.makeTranslation(x, y, z);
      mats.push(m);
    }
  }
  if (!mats.length) return null;

  const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 5.2, 5, 1);
  poleGeo.translate(0, 2.6, 0);
  const bulbGeo = new THREE.SphereGeometry(0.24, 8, 6);
  bulbGeo.translate(0, 5.35, 0);

  const poleMat = new THREE.MeshStandardNodeMaterial();
  poleMat.color = new THREE.Color('#2c3033');
  poleMat.roughness = 0.8;

  const bulbMat = new THREE.MeshStandardNodeMaterial();
  bulbMat.color = new THREE.Color('#6f6a5a');
  bulbMat.roughness = 0.4;
  bulbMat.emissiveNode = uNight.mul(5.0).mul(vec3(1.0, 0.72, 0.4));

  const poles = new THREE.InstancedMesh(poleGeo, poleMat, mats.length);
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, mats.length);
  mats.forEach((m, i) => {
    poles.setMatrixAt(i, m);
    bulbs.setMatrixAt(i, m);
  });
  poles.instanceMatrix.needsUpdate = true;
  bulbs.instanceMatrix.needsUpdate = true;
  poles.computeBoundingSphere();
  bulbs.computeBoundingSphere();
  poles.castShadow = false;
  bulbs.castShadow = false;
  return { poles, bulbs };
}
