import * as THREE from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  floor,
  fract,
  max,
  min,
  mix,
  mx_noise_float,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  sin,
  smoothstep,
  step,
  uniform,
  uv,
  varying,
  vec3
} from 'three/tsl';
import { uNight, uSkyHorizon } from './shared';

export function createBuildingMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial();
  material.side = THREE.FrontSide;
  material.roughness = 0.86;
  material.metalness = 0.0;
  material.fog = true;

  const seed = varying(attribute('aSeed', 'float'));
  const part = varying(attribute('aPart', 'float'));
  const facade = varying(attribute('aFacade', 'vec3'));
  const roof = varying(attribute('aRoof', 'vec3'));
  const bHeight = varying(attribute('aHeight', 'float'));

  const u = uv().x;
  const v = uv().y;

  const cellW = mix(3.5, 4.7, fract(seed.mul(7.31)));
  const cellH = mix(3.3, 3.75, fract(seed.mul(3.17)));
  const cu = u.div(cellW);
  const cv = v.div(cellH);
  const fu = fract(cu);
  const fv = fract(cv);

  const winH = smoothstep(0.23, 0.29, fu).mul(smoothstep(0.71, 0.77, fu).oneMinus());
  const winV = smoothstep(0.28, 0.34, fv).mul(smoothstep(0.74, 0.8, fv).oneMinus());
  const windowMask = winH.mul(winV).mul(part.oneMinus());
  const frameH = smoothstep(0.18, 0.24, fu).mul(smoothstep(0.76, 0.82, fu).oneMinus());
  const frameV = smoothstep(0.23, 0.29, fv).mul(smoothstep(0.79, 0.85, fv).oneMinus());
  const frameMask = max(frameH.mul(frameV).sub(windowMask), 0.0).mul(part.oneMinus());

  const cellRand = fract(
    sin(floor(cu).mul(12.9898).add(floor(cv).mul(78.233)).add(seed.mul(43.71))).mul(43758.5453)
  );
  const buildingLit = fract(seed.mul(19.73)).mul(0.36).add(0.12);
  const lit = step(cellRand, buildingLit.mul(uNight).add(0.012)).mul(windowMask);
  const lampTint = mix(vec3(1.0, 0.58, 0.22), vec3(1.0, 0.86, 0.58), fract(seed.mul(13.7)));
  const shopBand = smoothstep(3.9, 4.5, v).oneMinus();
  const shopLit = shopBand.mul(windowMask).mul(step(fract(cellRand.mul(3.7)), uNight.mul(0.5)));

  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(max(viewDir.dot(normalize(normalWorld)), 0.0), 2.0).oneMinus();
  const glassDay = mix(vec3(0.035, 0.052, 0.07), vec3(0.16, 0.22, 0.28), fresnel);
  const glassNight = mix(glassDay, vec3(0.035, 0.045, 0.055), uNight);
  const glass = mix(glassNight, uSkyHorizon.mul(0.35), 0.22);

  const grain = mx_noise_float(positionWorld.mul(0.55)).mul(0.5).add(0.5);
  const stain = mx_noise_float(positionWorld.mul(0.11).add(17.3)).mul(0.5).add(0.5);
  const grime = smoothstep(0.4, 6.5, v).oneMinus().mul(0.14);
  const wallColor = facade
    .mul(mix(0.9, 1.18, grain))
    .mul(mix(0.9, 1.02, stain))
    .mul(grime.oneMinus());

  const tile = fract(v.mul(1.6));
  const tileLine = smoothstep(0.92, 1.0, tile);
  const roofColor = roof.mul(mix(0.85, 1.1, grain)).mul(tileLine.mul(0.16).oneMinus());

  const cornice = smoothstep(bHeight.sub(0.95), bHeight.sub(0.1), v).mul(part.oneMinus());
  const plinth = smoothstep(0.35, 0.95, v).oneMinus();
  let finalWall = mix(wallColor, wallColor.mul(1.16), cornice.mul(0.7));
  finalWall = mix(finalWall, wallColor.mul(0.82), frameMask.mul(0.55));
  finalWall = mix(finalWall, glass, windowMask);
  finalWall = finalWall.mul(plinth.mul(0.12).oneMinus());
  const baseColor = mix(finalWall, roofColor, part);

  material.colorNode = baseColor;
  material.emissiveNode = lampTint.mul(lit).mul(uNight.mul(1.0).add(0.008)).mul(0.95).add(lampTint.mul(shopLit).mul(uNight).mul(1.15));
  material.roughnessNode = mix(mix(0.87, 0.44, windowMask), 0.75, part);
  material.metalnessNode = mix(windowMask.mul(0.06), 0.0, part);

  return material;
}

export function createSimpleColorMaterial(color: THREE.ColorRepresentation, roughness = 0.9): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.color = new THREE.Color(color);
  m.roughness = roughness;
  return m;
}
