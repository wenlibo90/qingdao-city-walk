import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  cameraPosition,
  dot,
  max,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  pow,
  reflect,
  sin,
  smoothstep,
  time,
  vec3
} from 'three/tsl';
import { uNight, uSkyHorizon, uSunColor, uSunDir, uWaterDeep, uWaterShallow } from './shared';

export function createWaterMaterial(): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.side = 2;
  m.fog = true;

  const p = positionWorld;
  const t = time;

  const w1 = sin(p.x.mul(0.055).add(p.z.mul(0.042)).add(t.mul(0.72)));
  const w2 = sin(p.x.mul(0.135).sub(p.z.mul(0.115)).add(t.mul(1.25)));
  const w3 = sin(p.x.mul(0.32).add(p.z.mul(0.27)).sub(t.mul(1.9)));
  const ripple = w1.mul(0.48).add(w2.mul(0.32)).add(w3.mul(0.2));
  const detail = mx_noise_float(vec3(p.x.mul(0.32), t.mul(0.06), p.z.mul(0.32)));
  const patch = mx_noise_float(vec3(p.x.mul(0.085), t.mul(0.03), p.z.mul(0.085)));

  const bump = normalize(vec3(
    w2.mul(0.16).add(detail.mul(0.06)),
    1.0,
    w3.mul(0.16).add(detail.mul(0.05))
  ));

  const viewDir = normalize(cameraPosition.sub(p));
  const fresnel = pow(max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0).oneMinus();

  const deep = mix(uWaterDeep, uWaterShallow, smoothstep(-0.5, 0.8, ripple).mul(0.28));
  const reflectColor = mix(uWaterShallow, uSkyHorizon, 0.22).mul(mix(0.3, 0.55, fresnel));
  let color = mix(deep, reflectColor, fresnel.mul(0.2));
  color = color.mul(mix(0.89, 1.08, ripple.mul(0.5).add(0.5)));
  color = color.mul(mix(0.94, 1.06, detail.mul(0.5).add(0.5)));
  color = color.mul(mix(0.94, 1.04, patch.mul(0.5).add(0.5)));

  const sunRef = reflect(uSunDir.mul(-1.0), bump);
  const spec = pow(max(dot(sunRef, viewDir), 0.0), 220.0).mul(uNight.oneMinus()).mul(2.6);
  const moonRef = reflect(uSunDir, bump);
  const moonSpec = pow(max(dot(moonRef, viewDir), 0.0), 180.0).mul(uNight).mul(0.35);
  const sparkle = pow(max(ripple.mul(0.5).add(detail.mul(0.5)).add(0.15), 0.0), 26.0)
    .mul(fresnel).mul(uNight.oneMinus()).mul(0.35);

  color = color.add(uSunColor.mul(spec)).add(vec3(0.62, 0.72, 0.95).mul(moonSpec)).add(uSkyHorizon.mul(sparkle));

  m.colorNode = color;
  return m;
}
