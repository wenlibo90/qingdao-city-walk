import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export const uTime = uniform(0);
export const uNight = uniform(0);
export const uDay = uniform(1);
export const uSunDir = uniform(new THREE.Vector3(0.4, 0.7, 0.2));
export const uSunColor = uniform(new THREE.Color('#fff2d8'));
export const uSkyZenith = uniform(new THREE.Color('#2f6fbd'));
export const uSkyHorizon = uniform(new THREE.Color('#bfe0f5'));
export const uFogColor = uniform(new THREE.Color('#cfe4f2'));
export const uWaterDeep = uniform(new THREE.Color('#123a4a'));
export const uWaterShallow = uniform(new THREE.Color('#2f6f76'));
export const uLightIntensity = uniform(1);
