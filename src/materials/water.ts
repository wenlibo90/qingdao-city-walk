import * as THREE from 'three/webgpu';
import {
  cameraPosition,
  cos,
  dot,
  float,
  max,
  min,
  mix,
  mx_noise_float,
  normalize,
  positionWorld,
  pow,
  reflect,
  sin,
  smoothstep,
  sqrt,
  time,
  vec3
} from 'three/tsl';
import { uNight, uSunColor, uSunDir, uWaterDeep, uWaterShallow } from './shared';
import { createSkyColorNode } from './sky';

interface Wave {
  x: number;
  z: number;
  length: number;
  amp: number;
  phase: number;
}

// 多方向、多波长的波浪叠加：长波负责大尺度起伏，短波负责海面细碎反光。
const WAVES: Wave[] = [
  { x: 0.93, z: 0.37, length: 118, amp: 0.5, phase: 0 },
  { x: -0.62, z: 0.78, length: 73, amp: 0.34, phase: 1.7 },
  { x: 0.78, z: -0.63, length: 43, amp: 0.22, phase: 4.2 },
  { x: -0.94, z: -0.34, length: 25, amp: 0.12, phase: 2.6 },
  { x: 0.45, z: 0.89, length: 14, amp: 0.065, phase: 5.4 },
  { x: -0.36, z: -0.93, length: 8.5, amp: 0.035, phase: 0.9 },
  { x: 0.99, z: 0.14, length: 5.1, amp: 0.018, phase: 3.3 },
  { x: -0.82, z: 0.57, length: 3.2, amp: 0.011, phase: 6.1 }
];

const TAU = Math.PI * 2;

export function createWaterMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  m.side = THREE.DoubleSide;
  m.fog = true;

  const p = positionWorld;
  const t = time;

  let height: any = float(0);
  let slopeX: any = float(0);
  let slopeZ: any = float(0);

  for (const wave of WAVES) {
    const k = TAU / wave.length;
    const omega = Math.sqrt(9.81 * k);
    const phase = p.x
      .mul(wave.x * k)
      .add(p.z.mul(wave.z * k))
      .sub(t.mul(omega))
      .add(wave.phase);
    const s = sin(phase);
    const c = cos(phase);
    height = height.add(s.mul(wave.amp));
    slopeX = slopeX.add(c.mul(wave.amp * k * wave.x));
    slopeZ = slopeZ.add(c.mul(wave.amp * k * wave.z));
  }

  // 噪声让规则正弦波形碎开，避免海面出现明显重复纹理。
  const microA = mx_noise_float(vec3(p.x.mul(0.17), p.z.mul(0.19), t.mul(0.09)));
  const microB = mx_noise_float(vec3(p.x.mul(0.47).add(31.7), p.z.mul(0.43), t.mul(0.2)));
  slopeX = slopeX.add(microA.mul(0.026)).add(microB.mul(0.012));
  slopeZ = slopeZ.add(microB.mul(0.024)).sub(microA.mul(0.011));

  const N = normalize(vec3(slopeX.mul(-1.0), float(1.0), slopeZ.mul(-1.0)));
  const V = normalize(cameraPosition.sub(p));
  const NoV = max(dot(N, V), 0.015);
  const fresnel = pow(NoV.oneMinus(), 5.0).mul(0.978).add(0.022);

  // 直接复用程序化天空采样倒影，天色变化时海面倒影自动保持一致。
  const reflected = reflect(V.mul(-1.0), N);
  const skyReflection = createSkyColorNode(
    normalize(vec3(reflected.x, max(reflected.y, 0.03), reflected.z))
  );

  const dayFactor = uNight.oneMinus();
  const body = mix(uWaterDeep, uWaterShallow, smoothstep(-0.6, 1.1, height).mul(0.32).add(0.06));
  let color = mix(body.mul(mix(0.5, 1.0, dayFactor)), skyReflection, fresnel.mul(0.94).add(0.015));

  // 太阳高光 + 宽一些的银色反光带。
  const H = normalize(V.add(uSunDir));
  const ndh = max(dot(N, H), 0.0);
  const specular = pow(ndh, 360.0).mul(9.0).add(pow(ndh, 32.0).mul(0.14));
  color = color.add(uSunColor.mul(specular).mul(dayFactor));

  // 陡峭浪尖上的白浪泡沫。
  const steepness = sqrt(slopeX.mul(slopeX).add(slopeZ.mul(slopeZ)));
  const crest = smoothstep(0.5, 1.0, height).mul(smoothstep(0.05, 0.17, steepness));
  const foamNoise = mx_noise_float(vec3(p.x.mul(0.33), p.z.mul(0.31), t.mul(0.07)));
  const foam = crest.mul(smoothstep(0.02, 0.5, foamNoise.mul(0.5).add(0.5))).mul(0.42);
  color = mix(color, vec3(0.82, 0.88, 0.9).mul(mix(0.16, 1.0, dayFactor)), foam);

  m.colorNode = color;
  return m;
}
