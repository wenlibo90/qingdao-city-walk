import './style.css';
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
const loadingStatus = $<HTMLElement>('loading-status');
const loadingBar = $<HTMLElement>('loading-bar');

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function setLoading(text: string, progress: number) {
  loadingStatus.textContent = text;
  loadingBar.style.width = `${Math.round(progress * 100)}%`;
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

  setLoading('读取 OSM 地理数据…', 0.06);
  await nextFrame();
  const data = await loadWorld(`${import.meta.env.BASE_URL}data/qingdao-city.geojson`);
  setLoading(`解析 ${data.buildings.length} 栋建筑 / ${data.roads.length} 段道路…`, 0.14);
  await nextFrame();

  setLoading('加载真实 DEM 高程网格…', 0.19);
  await nextFrame();
  try {
    const meta = await fetch(`${import.meta.env.BASE_URL}data/qingdao-dem.json`).then((r) => r.json());
    const bin = await fetch(`${import.meta.env.BASE_URL}data/qingdao-dem.bin`).then((r) => r.arrayBuffer());
    setDemGrid({ ...meta, data: new Int16Array(bin) });
  } catch (error) {
    console.warn('DEM 加载失败，回退到解析地形', error);
  }

  const time = new TimeOfDay(scene, renderer, sun, hemi, (strength) => {
    if (bloomPass) bloomPass.strength.value = strength;
  });

  setLoading('构建海岸线、真实地形与水域…', 0.3);
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

  setLoading('程序化挤出建筑体块与红瓦屋顶…', 0.44);
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

  setLoading('铺设道路、台阶与广场…', 0.6);
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

  const cityLights: THREE.PointLight[] = [
    new THREE.PointLight('#ffc98a', 0, 65, 1.6),
    new THREE.PointLight('#ffc98a', 0, 65, 1.6),
    new THREE.PointLight('#ffc98a', 0, 65, 1.6),
    new THREE.PointLight('#ffd39a', 0, 90, 1.7),
    new THREE.PointLight('#ffc98a', 0, 95, 1.7)
  ];
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

  const landmarks = createLandmarks(data);
  scene.add(landmarks.group);

  setLoading('准备步行碰撞与传送点…', 0.74);
  await nextFrame();

  const character = createCharacter();
  scene.add(character);
  const player = new PlayerController(camera, data, collision, character, renderer.domElement as HTMLElement);

  const startXZ: [number, number] = [-335.8, 100];
  player.place(startXZ[0], startXZ[1], Math.PI + 0.2, -0.015);

  const targets = buildTargets(data, player);
  const tour = new CameraTour(camera);
  tour.setKeys(buildTourKeys(targets));

  let toastTimer = 0;
  const fade = $<HTMLDivElement>('fade');

  const ui = new UI(
    data,
    {
      onPreset: (hour) => {
        time.setHour(hour, true);
        ui.toast(`切换光线：${phaseName(hour)}`);
      },
      onSlider: (hour) => time.setHour(hour, false),
      onStreet: (street) => teleportToStreet(street),
      onTeleport: (target) => teleportTo(target),
      onToggleTour: () => {
        if (tour.active) stopTour();
        else startTour();
      },
      onToggleView: () => {
        if (tour.active) return;
        player.toggleMode();
      }
    },
    targets
  );
  ui.setBackend(backend);
  ui.setMode(player.mode);
  ui.showModeTip();
  window.setTimeout(() => ui.hideModeTip(), 6000);

  player.onModeChange = (mode) => {
    ui.setMode(mode);
    ui.toast(mode === 'first' ? '第一人称步行' : '第三人称跟随');
  };

  async function teleportTo(target: TeleportTarget) {
    window.clearTimeout(toastTimer);
    fade.classList.add('on');
    await new Promise((r) => setTimeout(r, 270));
    player.place(target.x, target.z, target.yaw);
    ui.hideModeTip();
    fade.classList.remove('on');
    ui.toast(`已抵达 ${target.name}`);
    toastTimer = window.setTimeout(() => ui.toast(''), 2200);
  }

  function teleportToStreet(street: StreetEntry) {
    if (tour.active) stopTour();
    const [x, z] = nearestPointOnStreet(player.position.x, player.position.z, street.points);
    const yaw = player.yaw;
    void teleportTo({ id: street.name, name: street.name, caption: '街道', x, z, yaw });
  }

  let saved: { x: number; z: number; yaw: number; pitch: number } | null = null;

  function startTour() {
    if (tour.active) return;
    saved = { x: player.position.x, z: player.position.z, yaw: player.yaw, pitch: player.pitch };
    player.enabled = false;
    player.exitPointerLock();
    character.visible = false;
    ui.setTour(true);
    ui.showCrosshair(false);
    ui.toast('自动巡游中 · 按 Esc 退出', 0);
    tour.start(() => endTour(false));
  }

  function stopTour() {
    if (!tour.active) return;
    tour.stop();
    endTour(true);
  }

  function endTour(restore: boolean) {
    player.enabled = true;
    if (restore && saved) player.place(saved.x, saved.z, saved.yaw, saved.pitch);
    ui.setTour(false);
    ui.showCrosshair(player.mode === 'first');
    ui.toast(restore ? '已退出巡游' : '巡游结束，点击画面开始步行');
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tour.active) stopTour();
  });

  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', resize);

  setLoading('编译 TSL 材质…', 0.9);
  await nextFrame();

  let last = performance.now();
  let frameCount = 0;
  let statTime = 0;
  let fps = 60;
  const focus = new THREE.Vector3();
  const clockStart = performance.now();

  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    time.update(dt);
    if (tour.active) {
      tour.update(dt);
      focus.copy(camera.position);
    } else {
      player.update(dt);
      focus.copy(player.position);
      if (player.position.y < -5) player.place(startXZ[0], startXZ[1], Math.PI + 0.2);
    }

    sky.position.copy(camera.position);
    sky.position.y -= 40;

    sun.position.copy(focus).addScaledVector(time.lightDirection, 360);
    sun.target.position.copy(focus);
    sun.target.updateMatrixWorld();

    landmarks.update(time.night, (now - clockStart) / 1000);
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
      ui.setFps(fps, calls);
    }
    ui.setTime(time.hour, time.phaseLabel);
  });

  if (import.meta.env.DEV) {
    (window as any).__qingdao = { scene, camera, renderer, player, time, tour, data, result, ui, pipeline, bloomPass };
  }

  ui.setLoading('完成', 1);
  await new Promise((resolve) => setTimeout(resolve, 160));
  ui.hideLoading();
  ui.toast('点击画面锁定鼠标，从栈桥开始漫游', 3600);
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

  const pavilion = findBuilding(data, '回澜阁');
  if (pavilion) {
    push('huilange', '回澜阁', '栈桥尽头的八角亭', pavilion.centroid[0], pavilion.centroid[1] - 13, Math.PI);
  }

  const cathedral = findBuilding(data, '圣弥爱尔');
  if (cathedral) {
    push('cathedral', '天主教堂', '圣弥爱尔大教堂', cathedral.centroid[0], cathedral.centroid[1] + 30, 0);
  }

  const [sx, sz] = lonLatToLocal(120.32636, 36.06675);
  push('signal', '信号山', '98m 观景平台', sx - 14, sz + 18, 2.4);

  const lighthouse = findBuilding(data, '小青岛灯塔');
  if (lighthouse) {
    push('lighthouse', '小青岛', '白色灯塔', lighthouse.centroid[0] - 13, lighthouse.centroid[1] + 11, yawTo(lighthouse.centroid[0] - 13, lighthouse.centroid[1] + 11, lighthouse.centroid[0], lighthouse.centroid[1]));
  }

  const [thx, thz] = lonLatToLocal(120.3222473, 36.0615606);
  push('tianhou', '天后宫', '太平路 · 民俗博物馆', thx, thz + 26, 0);

  const governor = findBuilding(data, '总督府');
  if (governor) push('governor', '总督府', '沂水路 · 德式建筑', governor.centroid[0], governor.centroid[1] + 28, 0);

  const zhongshan = data.streets.find((s) => s.name === '中山路');
  if (zhongshan) {
    const [x, z] = nearestPointOnStreet(lonLatToLocal(120.3137, 36.0655)[0], lonLatToLocal(120.3137, 36.0655)[1], zhongshan.points);
    push('zhongshan', '中山路', '百年商业街', x, z, 0);
  }

  const huashilou = findBuilding(data, '花石楼');
  if (huashilou) {
    push('badaguan', '八大关', '花石楼 · 万国建筑', huashilou.centroid[0], huashilou.centroid[1] + 34, 0);
  }

  const [mx, mz] = lonLatToLocal(120.38015, 36.06121);
  push('mayfourth', '五四广场', '五月的风', mx, mz + 72, 0);

  const [ox, oz] = lonLatToLocal(120.3892, 36.0580);
  push('olympic', '奥帆中心', '浮山湾帆船港', ox, oz, 2.2);

  const [tpx, tpz] = lonLatToLocal(120.3490, 36.0522);
  push('taiping', '太平角', '第二海水浴场', tpx, tpz + 18, 2.9);

  return list;
}

function buildTourKeys(targets: TeleportTarget[]) {
  const get = (id: string) => targets.find((t) => t.id === id);
  const zhan = get('zhanqiao');
  const hui = get('huilange');
  const cathedral = get('cathedral');
  const signal = get('signal');
  const lighthouse = get('lighthouse');
  const governor = get('governor');
  const badaguan = get('badaguan');
  const mayfourth = get('mayfourth');
  const olympic = get('olympic');

  const zx = zhan?.x ?? 0;
  const zz = zhan?.z ?? 0;
  const hx = hui?.x ?? zx;
  const hz = hui?.z ?? zz + 380;
  const cx = cathedral?.x ?? -220;
  const cz = cathedral?.z ?? -880;
  const sx = signal?.x ?? 980;
  const sz = signal?.z ?? -690;
  const lx = lighthouse?.x ?? 130;
  const lz = lighthouse?.z ?? 1210;
  const gx = governor?.x ?? 160;
  const gz = governor?.z ?? -700;
  const bx = badaguan?.x ?? 3395;
  const bz = badaguan?.z ?? 960;
  const mx = mayfourth?.x ?? 6974;
  const mz = mayfourth?.z ?? 45;
  const ox = olympic?.x ?? 8100;
  const oz = olympic?.z ?? 250;

  return [
    { pos: new THREE.Vector3(zx - 40, 42, zz - 170), look: new THREE.Vector3(hx, 8, hz), duration: 9 },
    { pos: new THREE.Vector3(hx + 15, 10, hz - 80), look: new THREE.Vector3(hx, 7, hz), duration: 8 },
    { pos: new THREE.Vector3(cx - 70, 30, cz + 70), look: new THREE.Vector3(cx, 22, cz), duration: 9 },
    { pos: new THREE.Vector3(gx - 25, 26, gz + 55), look: new THREE.Vector3(gx, 12, gz), duration: 8 },
    { pos: new THREE.Vector3(sx + 60, 118, sz + 50), look: new THREE.Vector3(hx, 15, hz - 90), duration: 10 },
    { pos: new THREE.Vector3(lx - 95, 32, lz - 55), look: new THREE.Vector3(lx, 9, lz), duration: 9 },
    { pos: new THREE.Vector3(bx - 90, 72, bz + 130), look: new THREE.Vector3(bx, 20, bz), duration: 10 },
    { pos: new THREE.Vector3(bx + 55, 22, bz - 75), look: new THREE.Vector3(bx - 30, 13, bz + 85), duration: 9 },
    { pos: new THREE.Vector3(mx - 90, 46, mz + 110), look: new THREE.Vector3(mx, 22, mz), duration: 10 },
    { pos: new THREE.Vector3(ox - 95, 38, oz + 90), look: new THREE.Vector3(ox, 6, oz + 20), duration: 9 },
    { pos: new THREE.Vector3(ox - 120, 96, oz + 280), look: new THREE.Vector3(mx, 28, mz - 80), duration: 10 }
  ];
}

main().catch((error) => {
  console.error(error);
  loadingStatus.textContent = `初始化失败：${error instanceof Error ? error.message : String(error)}`;
  loadingStatus.style.color = '#e98b6a';
  loadingBar.style.width = '100%';
});
