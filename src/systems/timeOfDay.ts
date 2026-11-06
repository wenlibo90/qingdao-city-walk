import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import {
  uDay, uFogColor, uNight, uSkyHorizon, uSkyZenith, uSunColor, uSunDir, uWaterDeep, uWaterShallow
} from '../materials/shared';

const DEG = Math.PI / 180;

interface Keyframe {
  h: number;
  zenith: string;
  horizon: string;
  sun: string;
  sunI: number;
  night: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  fog: string;
  deep: string;
  shallow: string;
  exposure: number;
}

const KEYFRAMES: Keyframe[] = [
  { h: 0, night: 1, zenith: '#04070f', horizon: '#0a1428', sun: '#8fa8d8', sunI: 0.02, hemiSky: '#223453', hemiGround: '#0a0d14', hemiI: 0.7, fog: '#0a1222', deep: '#040f18', shallow: '#0a1c26', exposure: 0.95 },
  { h: 5.4, night: 0.82, zenith: '#1b2a4f', horizon: '#8a6c7a', sun: '#ffb27a', sunI: 0.22, hemiSky: '#3a4560', hemiGround: '#1a1612', hemiI: 0.52, fog: '#6f6478', deep: '#081e2a', shallow: '#163b45', exposure: 1.0 },
  { h: 7.2, night: 0.22, zenith: '#4f7fb5', horizon: '#f0c9a8', sun: '#ffd3a0', sunI: 1.15, hemiSky: '#8fb3d4', hemiGround: '#5b5140', hemiI: 0.8, fog: '#c8c0b8', deep: '#0d3040', shallow: '#2a626b', exposure: 1.2 },
  { h: 12.5, night: 0, zenith: '#2d6cba', horizon: '#bfe0f5', sun: '#fff6e2', sunI: 2.3, hemiSky: '#bcd9ee', hemiGround: '#6b6252', hemiI: 1.0, fog: '#cfe4f2', deep: '#0f3544', shallow: '#2c6b73', exposure: 1.0 },
  { h: 17.5, night: 0.08, zenith: '#40628f', horizon: '#ffb35c', sun: '#ffa757', sunI: 1.65, hemiSky: '#d0a98a', hemiGround: '#5a4430', hemiI: 0.78, fog: '#e2b28d', deep: '#0e2b36', shallow: '#2c5e63', exposure: 1.2 },
  { h: 19.3, night: 0.55, zenith: '#16233f', horizon: '#4b5a83', sun: '#7e93c9', sunI: 0.2, hemiSky: '#3b4a70', hemiGround: '#171a22', hemiI: 0.45, fog: '#3f4d70', deep: '#081827', shallow: '#123246', exposure: 1.0 },
  { h: 21.5, night: 0.95, zenith: '#03060e', horizon: '#0a1325', sun: '#6f88c0', sunI: 0.012, hemiSky: '#223251', hemiGround: '#0a0d14', hemiI: 0.78, fog: '#070e1b', deep: '#030d16', shallow: '#071b25', exposure: 0.88 },
  { h: 24, night: 1, zenith: '#04070f', horizon: '#0a1428', sun: '#8fa8d8', sunI: 0.02, hemiSky: '#223453', hemiGround: '#0a0d14', hemiI: 0.7, fog: '#0a1222', deep: '#040f18', shallow: '#0a1c26', exposure: 0.95 }
];

const C = (hex: string) => new THREE.Color(hex);

const KF = KEYFRAMES.map((k) => ({
  ...k,
  zenithC: C(k.zenith), horizonC: C(k.horizon), sunC: C(k.sun),
  hemiSkyC: C(k.hemiSky), hemiGroundC: C(k.hemiGround), fogC: C(k.fog),
  deepC: C(k.deep), shallowC: C(k.shallow)
}));

export interface TimePreset { label: string; hour: number; }

export const TIME_PRESETS: TimePreset[] = [
  { label: '清晨', hour: 7.2 },
  { label: '正午', hour: 12.5 },
  { label: '黄金时刻', hour: 17.5 },
  { label: '蓝调', hour: 19.3 },
  { label: '夜晚', hour: 21.5 }
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

export class TimeOfDay {
  hour = 17.5;
  targetHour = 17.5;
  night = 0;
  sunDirection = new THREE.Vector3(0.4, 0.5, 0.2).normalize();
  lightDirection = new THREE.Vector3(0.4, 0.5, 0.2).normalize();
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private scene: THREE.Scene;
  private renderer: WebGPURenderer;
  private onBloom: (v: number) => void;

  constructor(
    scene: THREE.Scene,
    renderer: WebGPURenderer,
    sun: THREE.DirectionalLight,
    hemi: THREE.HemisphereLight,
    onBloom: (v: number) => void
  ) {
    this.scene = scene;
    this.renderer = renderer;
    this.sun = sun;
    this.hemi = hemi;
    this.onBloom = onBloom;
    this.apply();
  }

  setHour(hour: number, animate = true) {
    this.targetHour = ((hour % 24) + 24) % 24;
    if (!animate) this.hour = this.targetHour;
  }

  update(dt: number) {
    let delta = this.targetHour - this.hour;
    if (delta > 12) delta -= 24;
    if (delta < -12) delta += 24;
    if (Math.abs(delta) > 0.001) {
      this.hour += delta * Math.min(1, dt * 4.5);
      this.hour = ((this.hour % 24) + 24) % 24;
    }
    this.apply();
  }

  get timeLabel(): string {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  get phaseLabel(): string {
    const h = this.hour;
    if (h < 5.3) return '深夜';
    if (h < 8.2) return '清晨';
    if (h < 11.5) return '上午';
    if (h < 15.0) return '正午';
    if (h < 18.4) return '黄金时刻';
    if (h < 20.2) return '蓝调';
    return '夜晚';
  }

  private apply() {
    const h = this.hour;
    let i = 0;
    for (; i < KF.length - 1; i++) if (h >= KF[i].h && h <= KF[i + 1].h) break;
    const a = KF[Math.min(i, KF.length - 2)];
    const b = KF[Math.min(i + 1, KF.length - 1)];
    const t = THREE.MathUtils.clamp((h - a.h) / Math.max(0.0001, b.h - a.h), 0, 1);
    const st = t * t * (3 - 2 * t);

    uSkyZenith.value.copy(tmpA.lerpColors(a.zenithC, b.zenithC, st));
    uSkyHorizon.value.copy(tmpA.lerpColors(a.horizonC, b.horizonC, st));
    uSunColor.value.copy(tmpA.lerpColors(a.sunC, b.sunC, st));
    uFogColor.value.copy(tmpA.lerpColors(a.fogC, b.fogC, st));
    uWaterDeep.value.copy(tmpA.lerpColors(a.deepC, b.deepC, st));
    uWaterShallow.value.copy(tmpA.lerpColors(a.shallowC, b.shallowC, st));

    const sunI = THREE.MathUtils.lerp(a.sunI, b.sunI, st);
    const hemiI = THREE.MathUtils.lerp(a.hemiI, b.hemiI, st);

    const theta = ((h - 6) / 12) * Math.PI;
    const elevation = Math.sin(theta) * 68 * DEG;
    const azimuth = ((h - 6) / 12) * Math.PI;
    const cosEl = Math.cos(elevation);
    this.sunDirection.set(Math.cos(azimuth) * cosEl, Math.sin(elevation), Math.sin(azimuth) * cosEl).normalize();

    this.night = THREE.MathUtils.lerp(a.night, b.night, st);

    uSunDir.value.copy(this.sunDirection);
    uNight.value = this.night;
    uDay.value = 1 - this.night;

    this.lightDirection.copy(this.sunDirection);
    if (this.lightDirection.y < 0.04) this.lightDirection.set(-this.sunDirection.x, Math.max(0.25, -this.sunDirection.y), -this.sunDirection.z).normalize();

    this.sun.color.copy(tmpA.lerpColors(a.sunC, b.sunC, st));
    if (this.night > 0.65) this.sun.color.copy(tmpB.set('#8fa6d6'));
    this.sun.intensity = Math.max(sunI * (1 - this.night * 0.7), this.night * 0.24);

    this.hemi.color.copy(tmpA.lerpColors(a.hemiSkyC, b.hemiSkyC, st));
    this.hemi.groundColor.copy(tmpA.lerpColors(a.hemiGroundC, b.hemiGroundC, st));
    this.hemi.intensity = hemiI;

    this.scene.fog?.color.copy(uFogColor.value);
    if (this.scene.fog instanceof THREE.FogExp2) this.scene.fog.density = 0.0003 + this.night * 0.00016;
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(a.exposure, b.exposure, st) + this.night * 0.05;
    this.onBloom(THREE.MathUtils.lerp(0.12, 0.36, this.night));
  }
}
