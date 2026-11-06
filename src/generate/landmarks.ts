import * as THREE from 'three/webgpu';
import type { WorldData } from '../world/loadWorld';
import { findBuilding } from '../world/loadWorld';
import { lonLatToLocal, terrainHeight } from '../core/geo';
import { createSimpleColorMaterial } from '../materials/buildings';

export interface LandmarkExtras {
  group: THREE.Group;
  update: (night: number, time: number) => void;
}

export function createLandmarks(data: WorldData): LandmarkExtras {
  const group = new THREE.Group();
  group.name = 'landmarks';

  const white = createSimpleColorMaterial('#e9e6db', 0.72);
  const red = createSimpleColorMaterial('#b23a2e', 0.68);
  const stone = createSimpleColorMaterial('#b9ae96', 0.92);
  const glass = new THREE.MeshStandardNodeMaterial();
  glass.color = new THREE.Color('#26323c');
  glass.roughness = 0.18;
  glass.metalness = 0.2;
  glass.emissive = new THREE.Color('#ffd9a0');
  glass.emissiveIntensity = 0;

  const lighthouse = findBuilding(data, '小青岛灯塔');
  let lampLight: THREE.PointLight | null = null;
  if (lighthouse) {
    const [cx, cz] = lighthouse.centroid;
    const base = terrainHeight(cx, cz) - 0.4;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 2.05, 15, 12, 1), white);
    tower.position.set(cx, base + 7.5, cz);
    group.add(tower);

    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.58, 1.7, 1.6, 12, 1), red);
    band.position.set(cx, base + 13.4, cz);
    group.add(band);

    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.55, 16, 1), stone);
    gallery.position.set(cx, base + 15.2, cz);
    group.add(gallery);

    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 2.1, 12, 1), glass);
    lantern.position.set(cx, base + 16.5, cz);
    group.add(lantern);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.65, 2.0, 12, 1), red);
    cap.position.set(cx, base + 18.5, cz);
    group.add(cap);

    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), red);
    finial.position.set(cx, base + 19.7, cz);
    group.add(finial);

    lampLight = new THREE.PointLight('#ffd38a', 0, 120, 1.5);
    lampLight.position.set(cx, base + 16.4, cz);
    group.add(lampLight);
  }

  const [sx, sz] = lonLatToLocal(120.32636, 36.06675);
  const sy = terrainHeight(sx, sz);
  const podium = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 9.2, 1.4, 20, 1), stone);
  podium.position.set(sx, sy + 0.7, sz);
  group.add(podium);

  const railing = new THREE.Mesh(new THREE.TorusGeometry(8.2, 0.18, 6, 32), stone);
  railing.rotation.x = Math.PI / 2;
  railing.position.set(sx, sy + 2.0, sz);
  group.add(railing);

  const domePositions: Array<[number, number, number]> = [
    [-4.6, 0, -2.2],
    [4.6, 0, -2.2],
    [0, 0, 4.8]
  ];
  for (const [dx, , dz] of domePositions) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.35, 4.4, 12, 1), white);
    col.position.set(sx + dx, sy + 3.4, sz + dz);
    group.add(col);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.15, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), red);
    dome.position.set(sx + dx, sy + 5.55, sz + dz);
    group.add(dome);
  }



  const huashilou = findBuilding(data, '花石楼');
  if (huashilou) {
    const [hx, hz] = huashilou.centroid;
    const hy = terrainHeight(hx, hz);
    const stoneTower = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.7, 19, 10, 1), stone);
    stoneTower.position.set(hx + 7, hy + 9.3, hz + 4);
    stoneTower.castShadow = true;
    group.add(stoneTower);
    const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(4.0, 3.6, 10, 1), red);
    towerRoof.position.set(hx + 7, hy + 20.6, hz + 4);
    towerRoof.castShadow = true;
    group.add(towerRoof);
    const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 4.3, 0.8, 10, 1), stone);
    towerBase.position.set(hx + 7, hy + 0.5, hz + 4);
    group.add(towerBase);
  }

  const [mayX, mayZ] = lonLatToLocal(120.38015, 36.06121);
  const mayY = terrainHeight(mayX, mayZ);
  const plazaMat = createSimpleColorMaterial('#a9a08e', 0.92);
  plazaMat.side = THREE.DoubleSide;
  const plazaGeo = new THREE.BufferGeometry();
  const pos: number[] = [mayX, mayY + 0.12, mayZ];
  const nor: number[] = [0, 1, 0];
  const uv: number[] = [0.5, 0.5];
  const idx: number[] = [];
  const rings = 24;
  const segs = 72;
  const radius = 38;
  for (let r = 1; r <= rings; r++) {
    const rr = (radius * r) / rings;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const x = mayX + Math.cos(a) * rr;
      const z = mayZ + Math.sin(a) * rr;
      pos.push(x, terrainHeight(x, z) + 0.12, z);
      nor.push(0, 1, 0);
      uv.push(0.5 + Math.cos(a) * 0.5 * (r / rings), 0.5 + Math.sin(a) * 0.5 * (r / rings));
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  for (let r = 1; r < rings; r++) {
    const inner = 1 + (r - 1) * segs;
    const outer = 1 + r * segs;
    for (let s = 0; s < segs; s++) {
      const sn = (s + 1) % segs;
      idx.push(inner + s, outer + sn, outer + s);
      idx.push(inner + s, inner + sn, outer + sn);
    }
  }
  plazaGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  plazaGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  plazaGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  plazaGeo.setIndex(idx);
  const plaza = new THREE.Mesh(plazaGeo, plazaMat);
  plaza.receiveShadow = true;
  group.add(plaza);

  const sculptureMat = new THREE.MeshStandardNodeMaterial();
  sculptureMat.color = new THREE.Color('#b52f26');
  sculptureMat.roughness = 0.52;
  sculptureMat.metalness = 0.35;
  sculptureMat.emissive = new THREE.Color('#8c1f17');
  sculptureMat.emissiveIntensity = 0.25;
  const helix: THREE.Vector3[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const angle = t * Math.PI * 4.34;
    const radius = 10.5 * (1 - t * 0.58);
    helix.push(new THREE.Vector3(
      mayX + Math.cos(angle) * radius,
      mayY + 0.6 + t * 30,
      mayZ + Math.sin(angle) * radius
    ));
  }
  const curve = new THREE.CatmullRomCurve3(helix);
  const sculpture = new THREE.Mesh(new THREE.TubeGeometry(curve, 140, 1.25, 8, false), sculptureMat);
  sculpture.castShadow = true;
  group.add(sculpture);

  const plazaLights = [
    new THREE.PointLight('#ffd0a0', 0, 105, 1.6),
    new THREE.PointLight('#ffc58c', 0, 125, 1.6)
  ];
  plazaLights[0].position.set(mayX, mayY + 7.5, mayZ + 25);
  plazaLights[1].position.set(mayX, mayY + 7.5, mayZ + 55);
  for (const l of plazaLights) group.add(l);

  const baseRing = new THREE.Mesh(new THREE.TorusGeometry(10.5, 0.45, 6, 24), sculptureMat);
  baseRing.rotation.x = Math.PI / 2;
  baseRing.position.set(mayX, mayY + 0.55, mayZ);
  group.add(baseRing);

  const update = (night: number, time: number) => {
    glass.emissiveIntensity = night * 3.4;
    if (lampLight) lampLight.intensity = night * 900;
    const pulse = 0.85 + Math.sin(time * 1.2) * 0.15;
    if (lampLight) lampLight.intensity *= pulse;
    sculptureMat.emissiveIntensity = 0.25 + night * 0.9;
    for (const l of plazaLights) l.intensity = night * 160;
  };

  return { group, update };
}
