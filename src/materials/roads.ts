import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  floor,
  fract,
  max,
  mix,
  mx_noise_float,
  positionWorld,
  smoothstep,
  step,
  uv,
  varying,
  vec3
} from 'three/tsl';
import { uNight } from './shared';

export function createRoadMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  material.side = THREE.FrontSide;
  material.roughness = 0.78;
  material.metalness = 0.0;

  const type = varying(attribute('aType', 'float'));
  const seed = varying(attribute('aSeed', 'float'));
  const u = uv().x;
  const v = uv().y;

  const asphalt = vec3(0.095, 0.098, 0.108);
  const stone = vec3(0.33, 0.31, 0.275);
  const plaza = vec3(0.28, 0.265, 0.235);

  const grain = mx_noise_float(positionWorld.mul(1.9)).mul(0.5).add(0.5);
  const patch = mx_noise_float(positionWorld.mul(0.16).add(seed)).mul(0.5).add(0.5);

  const isFoot = step(type, 0.5);
  const isPlaza = step(3.5, type);
  const baseAsphalt = asphalt.mul(mix(0.72, 1.15, grain)).mul(mix(0.88, 1.04, patch));
  let color = mix(baseAsphalt, stone.mul(mix(0.8, 1.1, grain)), isFoot);
  color = mix(color, plaza.mul(mix(0.82, 1.12, grain)), isPlaza);

  const sidewalk = smoothstep(0.8, 0.86, abs(u)).mul(step(1.5, type)).mul(step(type, 3.5));
  color = mix(color, vec3(0.36, 0.35, 0.325).mul(mix(0.85, 1.06, grain)), sidewalk.mul(0.85));

  const dash = step(2.5, type)
    .mul(step(abs(u), 0.024))
    .mul(step(fract(v.div(9.0)), 0.52))
    .mul(smoothstep(0.0, 0.06, abs(u)).oneMinus());
  const lane = step(2.5, type)
    .mul(step(abs(abs(u).sub(0.46)), 0.012))
    .mul(step(fract(v.div(6.0)), 0.7));
  const marking = max(dash, lane).mul(step(type, 3.5)).mul(step(0.8, abs(u)).oneMinus());
  color = mix(color, vec3(0.78, 0.72, 0.48), marking.mul(0.85));

  const wx = fract(positionWorld.x.mul(0.8));
  const wz = fract(positionWorld.z.mul(0.8));
  const stoneGrid = max(
    step(abs(wx.sub(0.5)), 0.46).oneMinus(),
    step(abs(wz.sub(0.5)), 0.46).oneMinus()
  ).mul(max(isFoot, isPlaza));
  color = mix(color, color.mul(0.7), stoneGrid.mul(0.5));

  material.colorNode = color;
  material.roughnessNode = mix(0.8, 0.42, uNight);
  material.emissiveNode = uNight.mul(vec3(0.012, 0.016, 0.024));

  return material;
}
