import * as THREE from 'three';

export interface TourKey {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  duration: number;
}

export class CameraTour {
  active = false;
  private keys: TourKey[] = [];
  private segment = 0;
  private t = 0;
  private camera: THREE.PerspectiveCamera;
  private onEnd: (() => void) | null = null;
  private fromPos = new THREE.Vector3();
  private fromLook = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  setKeys(keys: TourKey[]) {
    this.keys = keys;
  }

  start(onEnd?: () => void) {
    if (!this.keys.length) return;
    this.active = true;
    this.segment = 0;
    this.t = 0;
    this.onEnd = onEnd ?? null;
    const k = this.keys[0];
    this.camera.position.copy(k.pos);
    this.camera.lookAt(k.look);
  }

  stop() {
    this.active = false;
  }

  update(dt: number) {
    if (!this.active || this.keys.length < 2) return;
    const a = this.keys[this.segment];
    const b = this.keys[this.segment + 1];
    if (!b) { this.finish(); return; }

    this.t += dt / a.duration;
    if (this.t >= 1) {
      this.t = 0;
      this.segment++;
      if (this.segment >= this.keys.length - 1) { this.finish(); return; }
      this.fromPos.copy(this.keys[this.segment].pos);
      this.fromLook.copy(this.keys[this.segment].look);
      return;
    }

    const st = this.t * this.t * (3 - 2 * this.t);
    const p0 = this.segment === 0 ? a.pos : this.fromPos;
    const l0 = this.segment === 0 ? a.look : this.fromLook;
    this.camera.position.lerpVectors(p0, b.pos, st);
    const look = new THREE.Vector3().lerpVectors(l0, b.look, st);
    this.camera.lookAt(look);
  }

  private finish() {
    this.active = false;
    const last = this.keys[this.keys.length - 1];
    this.camera.position.copy(last.pos);
    this.camera.lookAt(last.look);
    this.onEnd?.();
  }
}
