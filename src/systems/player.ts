import * as THREE from 'three/webgpu';
import { PIER_Y, distanceToRing, pointInPolygon, terrainHeight, type Vec2 } from '../core/geo';
import { pointOnLand, pointOnPier, type WorldData } from '../world/loadWorld';
import type { Collider } from '../generate/buildings';

const CELL = 72;
const RADIUS = 0.6;
const EYE = 1.68;

export class CollisionWorld {
  private cells = new Map<string, Collider[]>();

  constructor(colliders: Collider[]) {
    for (const c of colliders) {
      const cx0 = Math.floor(c.minX / CELL), cx1 = Math.floor(c.maxX / CELL);
      const cz0 = Math.floor(c.minZ / CELL), cz1 = Math.floor(c.maxZ / CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const key = `${cx}_${cz}`;
          const arr = this.cells.get(key) ?? [];
          arr.push(c);
          this.cells.set(key, arr);
        }
      }
    }
  }

  blocked(x: number, z: number): boolean {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const arr = this.cells.get(`${ix}_${iz}`);
        if (!arr) continue;
        for (const c of arr) {
          if (x < c.minX - RADIUS || x > c.maxX + RADIUS || z < c.minZ - RADIUS || z > c.maxZ + RADIUS) continue;
          const inHole = c.holes.some((h) => pointInPolygon(x, z, h));
          if (pointInPolygon(x, z, c.ring) && !inHole) return true;
          if (distanceToRing(x, z, c.ring) < RADIUS) return true;
          for (const h of c.holes) if (distanceToRing(x, z, h) < RADIUS) return true;
        }
      }
    }
    return false;
  }
}

export class PlayerController {
  position = new THREE.Vector3();
  yaw = Math.PI;
  pitch = -0.02;
  mode: 'first' | 'third' = 'first';
  enabled = true;
  eyeHeight = EYE;
  groundY = 0;
  velocity = new THREE.Vector2();
  onModeChange: ((mode: 'first' | 'third') => void) | null = null;

  private keys = new Set<string>();
  private camera: THREE.PerspectiveCamera;
  private data: WorldData;
  private collision: CollisionWorld;
  private dom: HTMLElement;
  private character: THREE.Group;
  private clock = 0;
  private pointerLocked = false;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(
    camera: THREE.PerspectiveCamera,
    data: WorldData,
    collision: CollisionWorld,
    character: THREE.Group,
    dom: HTMLElement
  ) {
    this.camera = camera;
    this.data = data;
    this.collision = collision;
    this.character = character;
    this.dom = dom;
    camera.rotation.order = 'YXZ';

    this.bind();
  }

  private bind() {
    const canvas = this.dom;
    canvas.addEventListener('click', () => {
      if (!this.enabled) return;
      if (!this.pointerLocked) canvas.requestPointerLock?.();
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.pointerLocked) {
        this.applyLook(e.movementX, e.movementY);
      } else if (this.dragging) {
        this.applyLook(e.clientX - this.lastX, e.clientY - this.lastY);
        this.lastX = e.clientX; this.lastY = e.clientY;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.enabled) return;
      if (!this.pointerLocked && (e.target as HTMLElement).tagName !== 'INPUT') {
        this.dragging = true;
        this.lastX = e.clientX; this.lastY = e.clientY;
      }
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });

    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      this.keys.add(e.code);
      if (e.code === 'KeyV' && this.enabled) {
        this.mode = this.mode === 'first' ? 'third' : 'first';
        this.onModeChange?.(this.mode);
      }
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private applyLook(dx: number, dy: number) {
    this.yaw -= dx * 0.0022;
    this.pitch -= dy * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.35, 1.35);
  }

  groundHeight(x: number, z: number): number {
    if (pointOnPier(x, z, this.data)) return PIER_Y + 0.05;
    return terrainHeight(x, z);
  }

  isWalkable(x: number, z: number): boolean {
    if (this.collision.blocked(x, z)) return false;
    return pointOnLand(x, z, this.data) || pointOnPier(x, z, this.data);
  }

  nearestWalkable(x: number, z: number, maxRadius = 45): [number, number] {
    if (this.isWalkable(x, z)) return [x, z];
    for (let r = 2; r <= maxRadius; r += 2) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 10) {
        const nx = x + Math.cos(a) * r;
        const nz = z + Math.sin(a) * r;
        if (this.isWalkable(nx, nz)) return [nx, nz];
      }
    }
    return [x, z];
  }

  place(x: number, z: number, yaw?: number, pitch?: number) {
    const [nx, nz] = this.nearestWalkable(x, z);
    this.position.set(nx, this.groundHeight(nx, nz), nz);
    this.groundY = this.position.y;
    this.velocity.set(0, 0);
    if (yaw !== undefined) this.yaw = yaw;
    if (pitch !== undefined) this.pitch = pitch;
    this.syncCamera(0.016);
  }

  update(dt: number) {
    this.clock += dt;
    if (!this.enabled) {
      this.character.visible = false;
      return;
    }

    const forward = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
    const right = new THREE.Vector2(Math.cos(this.yaw), -Math.sin(this.yaw));
    const input = new THREE.Vector2();
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) input.add(forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) input.sub(forward);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) input.add(right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) input.sub(right);
    if (input.lengthSq() > 0) input.normalize();

    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = sprint ? 8.2 : 4.3;
    const target = input.multiplyScalar(speed);
    const blend = 1 - Math.exp(-dt * 12);
    this.velocity.lerp(target, blend);

    let nx = this.position.x + this.velocity.x * dt;
    let nz = this.position.z + this.velocity.y * dt;

    if (!this.isWalkable(nx, this.position.z)) { nx = this.position.x; this.velocity.x = 0; }
    if (!this.isWalkable(nx, nz)) { nz = this.position.z; this.velocity.y = 0; }

    this.position.x = nx;
    this.position.z = nz;
    const ground = this.groundHeight(nx, nz);
    this.groundY = ground;
    this.position.y = THREE.MathUtils.lerp(this.position.y || ground, ground, 1 - Math.exp(-dt * 10));

    this.syncCamera(dt);

    if (this.character) {
      this.character.visible = this.mode === 'third';
      this.character.position.set(this.position.x, this.groundY, this.position.z);
      if (this.velocity.lengthSq() > 0.2) {
        const moveYaw = Math.atan2(-this.velocity.x, -this.velocity.y);
        this.character.rotation.y = moveYaw;
      } else {
        this.character.rotation.y = this.yaw + Math.PI;
      }
      const bob = Math.sin(this.clock * (sprint ? 13 : 9)) * Math.min(1, this.velocity.length() / 4) * 0.035;
      this.character.position.y += this.mode === 'third' ? Math.abs(bob) : 0;
    }
  }

  private syncCamera(_dt: number) {
    if (this.mode === 'first') {
      this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    } else {
      const cosPitch = Math.cos(this.pitch);
      const dir = new THREE.Vector3(
        -Math.sin(this.yaw) * cosPitch,
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * cosPitch
      );
      const target = new THREE.Vector3(this.position.x, this.position.y + 1.5, this.position.z);
      const cam = target.clone().addScaledVector(dir, -6.2).add(new THREE.Vector3(0, 0.6, 0));
      const minY = this.groundHeight(cam.x, cam.z) + 0.7;
      if (cam.y < minY) cam.y = minY;
      this.camera.position.copy(cam);
      this.camera.lookAt(target);
    }
  }

  exitPointerLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  toggleMode() {
    this.mode = this.mode === 'first' ? 'third' : 'first';
    this.onModeChange?.(this.mode);
  }
}

export function createCharacter(): THREE.Group {
  const group = new THREE.Group();
  const jacket = new THREE.MeshStandardNodeMaterial();
  jacket.color = new THREE.Color('#2c3b46');
  jacket.roughness = 0.82;
  const trousers = new THREE.MeshStandardNodeMaterial();
  trousers.color = new THREE.Color('#1d2429');
  trousers.roughness = 0.9;
  const skin = new THREE.MeshStandardNodeMaterial();
  skin.color = new THREE.Color('#c89b7b');
  skin.roughness = 0.8;

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.62, 4, 10), jacket);
  torso.position.y = 1.06;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), skin);
  head.position.y = 1.62;
  group.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.205, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardNodeMaterial({ color: '#1b1714' }));
  hair.position.y = 1.65;
  group.add(hair);
  const legGeo = new THREE.CapsuleGeometry(0.12, 0.55, 3, 8);
  const legL = new THREE.Mesh(legGeo, trousers);
  legL.position.set(-0.13, 0.45, 0);
  group.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.13;
  group.add(legR);
  group.visible = false;
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

export function nearestPointOnStreet(x: number, z: number, pieces: Vec2[][]): [number, number] {
  let best = Infinity;
  let bx = x, bz = z;
  for (const pts of pieces) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = a[0] + dx * t, pz = a[1] + dz * t;
      const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d < best) { best = d; bx = px; bz = pz; }
    }
  }
  return [bx, bz];
}
