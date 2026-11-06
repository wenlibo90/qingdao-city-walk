# 用户指令记忆

本文件记录用户的指令、偏好和项目知识，用于后续交互参考。

## 条目

### 构建与预览
- Date: 2026-11-06
- Context: Agent 在扩展青岛漫游区域后执行构建和预览时发现
- Category: 构建方法
- Instructions:
  - 构建命令：`npm run build`，产物输出到 `dist/`。
  - 本地预览：`npm run preview`，默认端口 4173；开发服务器端口 5173。
  - 当前构建体积约 920 KB，gzip 约 258 KB。
  - 开发服务器已在 `vite.config.ts` 配置 `host: '0.0.0.0'` 与 `*.cosmoplat.cn/.com/.net` 的 `allowedHosts`。

### 地理与高程数据生成
- Date: 2026-11-06
- Context: Agent 在接入 OSM multipolygon 与真实 DEM 时发现
- Category: 构建方法
- Instructions:
  - OSM 转换：`node scripts/prepare-osm.mjs raw.json public/data/qingdao-city.geojson`，使用 `osmtogeojson`，输出含建筑孔洞的 GeoJSON。
  - DEM 生成：`node scripts/fetch-dem.mjs`，下载 AWS Terrarium z=15 瓦片并输出 `public/data/qingdao-dem.bin` 与 `qingdao-dem.json`。
  - 运行时先加载 GeoJSON 与 DEM，再调用 `setDemGrid`；无 DEM 时 `terrainHeight` 回退解析地形。

### Headless 验证
- Date: 2026-11-06
- Context: Agent 在无 GPU 环境用 Chromium 复查场景时发现
- Category: 排错调试
- Instructions:
  - WebGPU 在 headless 下会报 “Instance dropped in popErrorScope”，验证 URL 加 `?webgl=1` 强制 WebGL2。
  - headless 的 rAF 被限频，截图前用 `page.evaluate` 调用 `window.__qingdao.pipeline.render()`。
  - 手动传送后天空球不会自动跟随，截图前需把半径大于 1000 的 `SphereGeometry` 天空球位置同步到相机。
  - `window.__qingdao` 暴露 `scene/camera/renderer/player/time/tour/data/result/ui/pipeline`。

### 地形巨型三角面排错
- Date: 2026-11-06
- Context: Agent 在五四广场第一人称视角发现黑色遮挡时发现
- Category: 排错调试
- Instructions:
  - 症状：相机附近出现 0.4 m 处的黑色地形面，遮住上半屏。
  - 原因：整块陆地 earcut 后共用 200000 次细分预算，预算耗尽后东部留下跨度数公里的巨型三角形，线性插值高度高于玩家视线。
  - 修复：每个 earcut 三角面使用独立细分预算（`src/generate/terrain.ts`），当前地形约 30 万三角形。
  - 复查方法：从相机发一条射线，对全部网格做三角形求交，定位最近命中的 mesh 与三角形顶点。

### 预览部署
- Date: 2026-11-06
- Context: Agent 完成构建后部署预览
- Category: 运维部署
- Instructions:
  - 4173 端口已有 `vite preview` 进程时，构建完成后会直接提供最新 `dist`，无需重启。
  - 预览地址通过 `request_preview` 获取；当前为 `https://4173-06d829f0b7e51e1e.code.cosmoplat.cn`。
  - 检查端口占用用 `ss -tlnp`；停止服务使用 `background_terminal_kill`，禁止 `pkill`/`killall`。
