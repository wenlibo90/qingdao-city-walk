import * as THREE from 'three/webgpu';
import {
  fract,
  mix,
  mx_noise_float,
  normalWorld,
  positionWorld,
  smoothstep,
  vec3
} from 'three/tsl';

export function createTerrainMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.side = THREE.DoubleSide;
  m.roughness = 0.96;
  m.metalness = 0;

  const n1 = mx_noise_float(positionWorld.mul(0.045)).mul(0.5).add(0.5);
  const n2 = mx_noise_float(positionWorld.mul(0.26).add(9.1)).mul(0.5).add(0.5);
  const green = mix(vec3(0.16, 0.235, 0.125), vec3(0.27, 0.32, 0.18), n1);
  const earth = mix(vec3(0.34, 0.29, 0.21), vec3(0.44, 0.38, 0.27), n2);
  const rock = vec3(0.36, 0.35, 0.32);
  const steep = smoothstep(0.82, 0.55, normalWorld.y).mul(0.9);
  let color = mix(green, earth, n2.mul(0.55));
  color = mix(color, rock, steep);
  color = color.mul(mix(0.88, 1.08, n1));

  m.colorNode = color;
  return m;
}

export function createGreenMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.side = THREE.DoubleSide;
  m.roughness = 0.94;
  m.metalness = 0;

  const kind = 0;
  const n = mx_noise_float(positionWorld.mul(0.2)).mul(0.5).add(0.5);
  const grass = mix(vec3(0.20, 0.32, 0.14), vec3(0.31, 0.42, 0.19), n);
  const wood = mix(vec3(0.10, 0.20, 0.105), vec3(0.17, 0.28, 0.13), n);
  m.colorNode = mix(grass, wood, smoothstep(0.52, 0.62, n).mul(0.55));
  return m;
}

export function createSandMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.side = THREE.DoubleSide;
  m.roughness = 0.95;
  const n = mx_noise_float(positionWorld.mul(0.5)).mul(0.5).add(0.5);
  m.colorNode = mix(vec3(0.52, 0.45, 0.31), vec3(0.66, 0.56, 0.39), n);
  return m;
}

export function createDeckMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.roughness = 0.9;
  m.metalness = 0.0;
  m.side = THREE.DoubleSide;

  const p = positionWorld;
  const grain = mx_noise_float(p.mul(1.4)).mul(0.5).add(0.5);
  const stain = mx_noise_float(p.mul(0.18).add(7.2)).mul(0.5).add(0.5);
  const seam = smoothstep(0.93, 1.0, fract(p.x.mul(0.55).add(p.z.mul(0.55))));
  const base = mix(vec3(0.42, 0.4, 0.35), vec3(0.58, 0.55, 0.47), grain);
  let color = base.mul(mix(0.9, 1.05, stain)).mul(seam.mul(0.22).oneMinus());
  color = mix(color, vec3(0.3, 0.29, 0.27), smoothstep(0.8, 1.0, stain).mul(0.3));

  m.colorNode = color;
  return m;
}
