import * as THREE from 'three/webgpu';
import {
  dot,
  floor,
  fract,
  max,
  mix,
  normalize,
  positionLocal,
  pow,
  sin,
  smoothstep,
  step,
  vec3
} from 'three/tsl';
import { uNight, uSkyHorizon, uSkyZenith, uSunColor, uSunDir } from './shared';

/**
 * 程序化天空：大气渐变 + 太阳光晕 + 星空/月亮/城市光污染。
 * 天空球和海水反射共用同一份计算，保证倒影与天色一致。
 */
export function createSkyColorNode(direction: any) {
  const d = normalize(direction);
  const y = max(d.y, -0.15);
  const grad = pow(max(y, 0.0), 0.52);
  let color = mix(uSkyHorizon, uSkyZenith, grad);

  const sun = max(dot(d, normalize(uSunDir)), 0.0);
  const disc = pow(sun, 1600.0).mul(6.0);
  const glow = pow(sun, 14.0).mul(0.45);
  const horizonWarm = pow(max(y.abs().oneMinus(), 0.0), 8.0).mul(pow(sun, 3.0)).mul(0.35);
  color = color.add(uSunColor.mul(disc.add(glow).add(horizonWarm)));

  const cell: any = floor(d.mul(210.0));
  const rnd = fract(sin(cell.x.mul(12.9898).add(cell.y.mul(78.233)).add(cell.z.mul(37.719))).mul(43758.5453));
  const stars = step(0.9982, rnd).mul(uNight).mul(smoothstep(0.02, 0.35, d.y));
  color = color.add(vec3(stars).mul(0.7));
  const cityGlow = pow(max(y.abs().oneMinus(), 0.0), 26.0).mul(uNight).mul(0.5);
  color = color.add(vec3(0.42, 0.23, 0.1).mul(cityGlow));

  const moon = pow(max(dot(d, normalize(uSunDir.mul(-1.0))), 0.0), 900.0).mul(uNight).mul(0.6);
  color = color.add(vec3(0.55, 0.65, 0.9).mul(moon));

  return color;
}

export function createSkyMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  m.side = THREE.BackSide;
  m.depthWrite = false;
  m.fog = false;
  m.colorNode = createSkyColorNode(positionLocal);
  return m;
}
