import * as THREE from 'three';
import { RenderPipeline, WebGPURenderer } from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

import { lonLatToLocal, setDemGrid, terrainHeight } from './core/geo';
import { findBuilding, loadWorld, pointOnLand, pointOnPier, type StreetEntry, type WorldData } from './world/loadWorld';
import { generateBuildings } from './generate/buildings';
import { generateRoads } from './generate/roads';
import {
  generateBeaches,
  generateCoastSkirt,
  generateGreens,
  generatePierDecks,
  generateTerrain,
  generateTrees
} from './generate/terrain';
import { createLandmarks } from './generate/landmarks';
import { generatePierLamps, generateStreetLamps } from './generate/lamps';
import { createBuildingMaterial, createSimpleColorMaterial } from './materials/buildings';
import { createRoadMaterial } from './materials/roads';
import { createDeckMaterial, createGreenMaterial, createSandMaterial, createTerrainMaterial } from './materials/terrain';
import { createWaterMaterial } from './materials/water';
import { createSkyMaterial } from './materials/sky';
import { TimeOfDay } from './systems/timeOfDay';
import { CollisionWorld, PlayerController, createCharacter, nearestPointOnStreet } from './systems/player';
import { CameraTour } from './systems/tour';
import { UI, type TeleportTarget } from './ui';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewport = $<HTMLDivElement>('viewport');

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function createBootStatus() {
  const el = document.createElement('div');
  el.className = 'boot-status';
  el.innerHTML = '<span class="boot-dot"></span><span class="boot-text">正在构建城市…</span><span class="boot-pct">0%</span>';
  document.body.appendChild(el);
  const text = el.querySelector('.boot-text') as HTMLElement;
  const pct = el.querySelector('.boot-pct') as HTMLElement;
  return {
    update(message: string, progress: number) {
      text.textContent = message;
      pct.textContent = `${Math.round(progress * 100)}%`;
    },
    done() {
      el.classList.add('done');
      window.setTimeout(() => el.remove(), 600);
    }
  };
}

async function createRenderer(): Promise<{ renderer: WebGPURenderer; backend: string }> {
  const forceWebGL = !('gpu' in navigator) || new URLSearchParams(location.search).has('webgl');
  try {
    const renderer = new WebGPURenderer({ antialias: true, forceWebGL });
    await renderer.init();
    return { renderer, backend: forceWebGL ? 'WEBGL2 FALLBACK · TSL' : 'WEBGPU · TSL' };
  } catch (error) {
    console.warn('WebGPU 初始化失败，切换到 WebGL2 后端', error);
    const renderer = new WebGPURenderer({ antialias: true, forceWebGL: true });
    await renderer.init();
    return { renderer, backend: 'WEBGL2 FALLBACK · TSL' };
  }
}

function yawTo(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

async function main() {
  // 数据请求与渲染器初始化并行，尽早出画面。
  const worldPromise = loadWorld(`${import.meta.env.BASE_URL}data/qingdao-city.geojson`);
  const demPromise = (async () => {
    const meta = await fetch(`${import.meta.env.BASE_URL}data/qingdao-dem.json`).then((r) => r.json());
    const bin = await fetch(`${import.meta.env.BASE_URL}data/qingdao-dem.bin`).then((r) => r.arrayBuffer());
    setDemGrid({ ...meta, data: new Int16Array(bin) });
  })().catch((error) => console.warn('DEM 加载失败，回退到解析地形', error));

  const boot = createBootStatus();
  boot.update('正在准备渲染器…', 0.04);

  const { renderer, backend } = await createRenderer();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  viewport.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#cfe4f2', 0.00033);

  const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.15, 7200);
  camera.rotation.order = 'YXZ';

  const hemi = new THREE.HemisphereLight('#bcd9ee', '#6b6252', 1);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#fff6e2', 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -150;
  sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150;
  sun.shadow.camera.bottom = -150;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.55;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(5600, 40, 24), createSkyMaterial());
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  const water = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), createWaterMaterial());
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  water.receiveShadow = false;
  scene.add(water);

  let pipeline: RenderPipeline | null = null;
  let bloomPass: ReturnType<typeof bloom> | null = null;
  try {
    pipeline = new RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    const color = scenePass.getTextureNode('output');
    bloomPass = bloom(color, 0.18, 0.45, 0.88);
    pipeline.outputNode = color.add(bloomPass);
  } catch (error) {
    console.warn('TSL 后处理初始化失败，使用直接渲染', error);
    pipeline = null;
  }

  const time = new TimeOfDay(scene, renderer, sun, hemi, (strength) => {
    if (bloomPass) bloomPass.strength.value = strength;
  });

  const [signalX, signalZ] = lonLatToLocal(120.32636, 36.06675);
  const startXZ: [number, number] = [signalX - 14, signalZ + 18];
  const startYaw = 2.4;

  camera.position.set(startXZ[0], 98, startXZ[1]);
  camera.rotation.set(-0.08, startYaw, 0);

  let player: PlayerController | null = null;
  let tour: CameraTour | null = null;
  let ui: UI | null = null;
  let landmarks: ReturnType<typeof createLandmarks> | null = null;
  let toastTimer = 0;
  const cityLights: THREE.PointLight[] = [];
  const focus = new THREE.Vector3();
  const clockStart = performance.now();
  let last = performance.now();
  let frameCount = 0;
  let statTime = 0;
  let fps = 60;

  // 先渲染天空和海面，城市几何在后台逐段生成并加入场景。
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    time.update(dt);
    if (tour?.active) {
      tour.update(dt);
      focus.copy(camera.position);
    } else if (player) {
      player.update(dt);
      focus.copy(player.position);
      if (player.position.y < -5) player.place(startXZ[0], startXZ[1], startYaw, -0.08);
    } else {
      focus.copy(camera.position);
    }

    sky.position.copy(camera.position);
    sky.position.y -= 40;

    sun.position.copy(focus).addScaledVector(time.lightDirection, 360);
    sun.target.position.copy(focus);
    sun.target.updateMatrixWorld();

    if (landmarks) landmarks.update(time.night, (now - clockStart) / 1000);
    for (const l of cityLights) l.intensity = time.night * 18;

    if (pipeline) pipeline.render();
    else renderer.render(scene, camera);

    frameCount++;
    statTime += dt;
    if (statTime > 0.5) {
      fps = frameCount / statTime;
      frameCount = 0;
      statTime = 0;
      const calls = (renderer.info?.render as unknown as { drawCalls?: number; calls?: number })?.drawCalls
        ?? (renderer.info?.render as unknown as { calls?: number })?.calls
        ?? 0;
      ui?.setFps(fps, calls);
    }
    ui?.setTime(time.hour, time.phaseLabel);
  });

  boot.update('读取地理数据…', 0.14);
  const data = await worldPromise;
  await demPromise;

  boot.update(`构建 ${data.buildings.length} 栋建筑的地形…`, 0.3);
  await nextFrame();
  const terrainMat = createTerrainMaterial();
  const terrainMesh = new THREE.Mesh(generateTerrain(data.landOuter, data.water, data.islets), terrainMat);
  terrainMesh.receiveShadow = true;
  terrainMesh.name = 'terrain';
  scene.add(terrainMesh);

  const coastMesh = new THREE.Mesh(generateCoastSkirt(data.coast), createSimpleColorMaterial('#6d6252', 0.97));
  coastMesh.receiveShadow = true;
  scene.add(coastMesh);

  const deckMesh = new THREE.Mesh(generatePierDecks(data.piers), createDeckMaterial());
  deckMesh.receiveShadow = true;
  deckMesh.castShadow = true;
  scene.add(deckMesh);

  const sandMesh = new THREE.Mesh(generateBeaches(data.beaches), createSandMaterial());
  sandMesh.receiveShadow = true;
  scene.add(sandMesh);

  const greenMesh = new THREE.Mesh(generateGreens(data.greens), createGreenMaterial());
  greenMesh.receiveShadow = true;
  scene.add(greenMesh);

  boot.update('程序化挤出建筑体块与红瓦屋顶…', 0.46);
  await nextFrame();
  const buildingMat = createBuildingMaterial();
  const result = generateBuildings(data);
  for (const geo of result.chunks.values()) {
    const mesh = new THREE.Mesh(geo, buildingMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const collision = new CollisionWorld(result.colliders);

  boot.update('铺设道路、台阶与广场…', 0.62);
  await nextFrame();
  const roadGeo = generateRoads(data);
  if (roadGeo) {
    const roadMesh = new THREE.Mesh(roadGeo, createRoadMaterial());
    roadMesh.receiveShadow = true;
    roadMesh.name = 'roads';
    scene.add(roadMesh);
  }

  const trunkMat = createSimpleColorMaterial('#4a382a', 0.96);
  const crownMat = createSimpleColorMaterial('#2b4524', 0.94);
  const trees = generateTrees(data.greens, trunkMat, crownMat);
  if (trees) {
    trees.trunks.castShadow = false;
    trees.crowns.castShadow = false;
    scene.add(trees.trunks, trees.crowns);
  }

  const lamps = generateStreetLamps(data.roads, (x, z) => (pointOnLand(x, z, data) || pointOnPier(x, z, data)) && !collision.blocked(x, z));
  if (lamps) scene.add(lamps.poles, lamps.bulbs);

  const pavilionForLamps = findBuilding(data, '回澜阁');
  if (pavilionForLamps) {
    const pierLamps = generatePierLamps(data.piers, pavilionForLamps.centroid);
    if (pierLamps) scene.add(pierLamps.poles, pierLamps.bulbs);
  }

  cityLights.push(
    new THREE.PointLight('#ffc98a', 0, 65, 1.6),
    new THREE.PointLight('#ffc98a', 0, 65, 1.6),
    new THREE.PointLight('#ffc98a', 0, 65, 1.6),
    new THREE.PointLight('#ffd39a', 0, 90, 1.7),
    new THREE.PointLight('#ffc98a', 0, 95, 1.7)
  );
  const lightPositions: Array<[number, number, number]> = [
    [-335.8, 7, 118],
    [-290, 7, 300],
    [-246, 7, 440],
    [-406, 9.5, -376],
    [-225, 10, -820]
  ];
  const extraLights: Array<[number, number]> = [
    lonLatToLocal(120.3475, 36.0545),
    lonLatToLocal(120.38015, 36.0615),
    lonLatToLocal(120.3892, 36.0580)
  ];
  for (const [x, z] of extraLights) lightPositions.push([x, terrainHeight(x, z) + 5.5, z]);
  while (cityLights.length < lightPositions.length) cityLights.push(new THREE.PointLight('#ffd39a', 0, 95, 1.7));
  for (let i = 0; i < 5; i++) lightPositions[i][1] = Math.max(lightPositions[i][1], terrainHeight(lightPositions[i][0], lightPositions[i][2]) + 4.5);
  cityLights.forEach((l, i) => {
    l.position.set(lightPositions[i][0], lightPositions[i][1], lightPositions[i][2]);
    scene.add(l);
  });

  landmarks = createLandmarks(data);
  scene.add(landmarks.group);

  boot.update('准备步行碰撞与传送点…', 0.78);
  await nextFrame();

  const character = createCharacter();
  scene.add(character);
  player = new PlayerController(camera, data, collision, character, renderer.domElement as HTMLElement);
  player.place(startXZ[0], startXZ[1], startYaw, -0.08);

  const targets = buildTargets(data, player);
  tour = new CameraTour(camera);
  tour.setKeys(buildTourKeys(targets));

  const fade = $<HTMLDivElement>('fade');

  const uiInstance = new UI(
    data,
    {
      onPreset: (hour) => {
        time.setHour(hour, true);
        uiInstance.toast(`切换光线：${phaseName(hour)}`);
      },
      onSlider: (hour) => time.setHour(hour, false),
      onStreet: (street) => teleportToStreet(street),
      onTeleport: (target) => void teleportTo(target),
      onToggleTour: () => {
        if (tour!.active) stopTour();
        else startTour();
      },
      onToggleView: () => {
        if (tour!.active) return;
        player!.toggleMode();
      }
    },
    targets
  );
  ui = uiInstance;
  uiInstance.setBackend(backend);
  uiInstance.setMode(player.mode);

  player.onModeChange = (mode) => {
    uiInstance.setMode(mode);
    uiInstance.toast(mode === 'first' ? '第一人称步行' : '第三人称跟随');
  };

  async function teleportTo(target: TeleportTarget) {
    window.clearTimeout(toastTimer);
    fade.classList.add('on');
    await new Promise((r) => setTimeout(r, 270));
    player!.place(target.x, target.z, target.yaw);
    fade.classList.remove('on');
    uiInstance.toast(`已抵达 ${target.name}`);
    toastTimer = window.setTimeout(() => uiInstance.toast(''), 2200);
  }

  function teleportToStreet(street: StreetEntry) {
    if (tour!.active) stopTour();
    const [x, z] = nearestPointOnStreet(player!.position.x, player!.position.z, street.points);
    const yaw = player!.yaw;
    void teleportTo({ id: street.name, name: street.name, caption: '街道', x, z, yaw });
  }

  let saved: { x: number; z: number; yaw: number; pitch: number } | null = null;

  function startTour() {
    if (tour!.active) return;
    saved = { x: player!.position.x, z: player!.position.z, yaw: player!.yaw, pitch: player!.pitch };
    player!.enabled = false;
    player!.exitPointerLock();
    character.visible = false;
    uiInstance.setTour(true);
    uiInstance.showCrosshair(false);
    uiInstance.toast('自动巡游中 · 按 Esc 退出', 0);
    tour!.start(() => endTour(false));
  }

  function stopTour() {
    if (!tour!.active) return;
    tour!.stop();
    endTour(true);
  }

  function endTour(restore: boolean) {
    player!.enabled = true;
    if (restore && saved) player!.place(saved.x, saved.z, saved.yaw, saved.pitch);
    uiInstance.setTour(false);
    uiInstance.showCrosshair(player!.mode === 'first');
    uiInstance.toast(restore ? '已退出巡游' : '巡游结束，点击画面开始步行');
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tour!.active) stopTour();
  });

  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);

  uiInstance.setTime(time.hour, time.phaseLabel);
  uiInstance.toast('点击画面锁定鼠标，开始步行探索', 3600);
  boot.done();

  if (import.meta.env.DEV) {
    (window as any).__qingdao = { scene, camera, renderer, player, time, tour, data, result, ui, pipeline, bloomPass };
  }
}

function phaseName(hour: number): string {
  if (hour < 5.3) return '深夜';
  if (hour < 8.2) return '清晨';
  if (hour < 11.5) return '上午';
  if (hour < 15) return '正午';
  if (hour < 18.4) return '黄金时刻';
  if (hour < 20.2) return '蓝调';
  return '夜晚';
}

function buildTargets(data: WorldData, _player: PlayerController): TeleportTarget[] {
  const list: TeleportTarget[] = [];
  const push = (id: string, name: string, caption: string, x: number, z: number, yaw: number) => {
    list.push({ id, name, caption, x, z, yaw });
  };

  const [pierX, pierZ] = lonLatToLocal(120.3149, 36.06035);
  push('zhanqiao', '栈桥', '青岛湾 · 回澜阁', pierX, pierZ, Math.PI);

  const [sx, sz] = lonLatToLocal(120.32636, 36.06675);
  push('signal', '信号山', '98m 观景平台', sx - 14, sz + 18, 2.4);

  const lighthouse = findBuilding(data, '小青岛灯塔');
  if (lighthouse) {
    push('lighthouse', '小青岛', '白色灯塔', lighthouse.centroid[0] - 13, lighthouse.centroid[1] + 11, yawTo(lighthouse.centroid[0] - 13, lighthouse.centroid[1] + 11, lighthouse.centroid[0], lighthouse.centroid[1]));
  }

  const huashilou = findBuilding(data, '花石楼');
  if (huashilou) {
    push('huashilou', '花石楼', '八大关 · 万国建筑', huashilou.centroid[0], huashilou.centroid[1] + 34, 0);
  }

  const [mx, mz] = lonLatToLocal(120.38015, 36.06121);
  push('mayfourth', '五四广场', '五月的风', mx, mz + 72, 0);

  return list;
}

function buildTourKeys(targets: TeleportTarget[]) {
  const get = (id: string) => targets.find((t) => t.id === id);
  const zhan = get('zhanqiao');
  const signal = get('signal');
  const lighthouse = get('lighthouse');
  const huashilou = get('huashilou');
  const mayfourth = get('mayfourth');

  const zx = zhan?.x ?? 0;
  const zz = zhan?.z ?? 0;
  const hx = zx;
  const hz = zz + 380;
  const sx = signal?.x ?? 980;
  const sz = signal?.z ?? -690;
  const lx = lighthouse?.x ?? 130;
  const lz = lighthouse?.z ?? 1210;
  const bx = huashilou?.x ?? 3395;
  const bz = huashilou?.z ?? 960;
  const mx = mayfourth?.x ?? 6974;
  const mz = mayfourth?.z ?? 45;

  return [
    { pos: new THREE.Vector3(zx - 40, 42, zz - 170), look: new THREE.Vector3(hx, 8, hz), duration: 9 },
    { pos: new THREE.Vector3(hx + 15, 10, hz - 80), look: new THREE.Vector3(hx, 7, hz), duration: 8 },
    { pos: new THREE.Vector3(sx + 60, 118, sz + 50), look: new THREE.Vector3(hx, 15, hz - 90), duration: 10 },
    { pos: new THREE.Vector3(lx - 95, 32, lz - 55), look: new THREE.Vector3(lx, 9, lz), duration: 9 },
    { pos: new THREE.Vector3(bx - 90, 72, bz + 130), look: new THREE.Vector3(bx, 20, bz), duration: 10 },
    { pos: new THREE.Vector3(bx + 55, 22, bz - 75), look: new THREE.Vector3(bx - 30, 13, bz + 85), duration: 9 },
    { pos: new THREE.Vector3(mx - 90, 46, mz + 110), look: new THREE.Vector3(mx, 22, mz), duration: 10 },
    { pos: new THREE.Vector3(mx + 120, 96, mz + 280), look: new THREE.Vector3(mx, 28, mz - 80), duration: 10 }
  ];
}

main().catch((error) => {
  console.error(error);
  const el = document.createElement('div');
  el.className = 'boot-status boot-error';
  el.textContent = `初始化失败：${error instanceof Error ? error.message : String(error)}`;
  document.body.appendChild(el);
});
