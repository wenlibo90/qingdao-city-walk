import * as THREE from 'three';

export type AttrType = 'float' | 'vec3';
export type AttrValue = number | [number, number, number];

export class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  attrs: Record<string, number[]> = {};
  private defs: Record<string, AttrType>;

  constructor(defs: Record<string, AttrType>) {
    this.defs = defs;
    for (const key of Object.keys(defs)) this.attrs[key] = [];
  }

  private pushVertex(
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    u: number, v: number,
    attrs: Record<string, AttrValue>
  ) {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.uvs.push(u, v);
    for (const key of Object.keys(this.defs)) {
      const val = attrs[key];
      if (this.defs[key] === 'vec3') {
        const a = val as [number, number, number];
        this.attrs[key].push(a[0], a[1], a[2]);
      } else {
        this.attrs[key].push(val as number);
      }
    }
  }

  tri(
    p0: [number, number, number], p1: [number, number, number], p2: [number, number, number],
    uv0: [number, number], uv1: [number, number], uv2: [number, number],
    attrs0: Record<string, AttrValue>, attrs1: Record<string, AttrValue>, attrs2: Record<string, AttrValue>,
    refNormal?: [number, number, number]
  ) {
    let ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    let bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    if (refNormal) {
      const d = nx * refNormal[0] + ny * refNormal[1] + nz * refNormal[2];
      if (d < 0) {
        [p1, p2] = [p2, p1];
        [uv1, uv2] = [uv2, uv1];
        [attrs1, attrs2] = [attrs2, attrs1];
        nx = -nx; ny = -ny; nz = -nz;
      }
    }

    this.pushVertex(p0[0], p0[1], p0[2], nx, ny, nz, uv0[0], uv0[1], attrs0);
    this.pushVertex(p1[0], p1[1], p1[2], nx, ny, nz, uv1[0], uv1[1], attrs1);
    this.pushVertex(p2[0], p2[1], p2[2], nx, ny, nz, uv2[0], uv2[1], attrs2);
  }

  quad(
    p0: [number, number, number], p1: [number, number, number], p2: [number, number, number], p3: [number, number, number],
    uv0: [number, number], uv1: [number, number], uv2: [number, number], uv3: [number, number],
    attrs0: Record<string, AttrValue>, attrs1: Record<string, AttrValue>, attrs2: Record<string, AttrValue>, attrs3: Record<string, AttrValue>,
    refNormal?: [number, number, number]
  ) {
    this.tri(p0, p1, p2, uv0, uv1, uv2, attrs0, attrs1, attrs2, refNormal);
    this.tri(p0, p2, p3, uv0, uv2, uv3, attrs0, attrs2, attrs3, refNormal);
  }

  build(): THREE.BufferGeometry | null {
    if (!this.positions.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    for (const key of Object.keys(this.attrs)) {
      const size = this.defs[key] === 'vec3' ? 3 : 1;
      geo.setAttribute(key, new THREE.Float32BufferAttribute(this.attrs[key], size));
    }
    geo.computeBoundingSphere();
    return geo;
  }
}
