# 青岛 · 山海城漫游

基于 Three.js WebGPU + TSL 的程序化城市漫游 MVP。场景中的建筑、道路、地形、植被、水面和材质全部在浏览器内实时生成；仓库只保存 OSM 矢量数据与 DEM 高程网格，不包含任何建筑模型或摄影测量贴图。

## 漫游区域

数据范围约 7.9 km × 3.7 km（120.3030–120.3920 E，36.0435–36.0770 N），覆盖青岛前海一线：

- 栈桥、回澜阁、中山路与老城红瓦街区
- 圣弥爱尔大教堂、信号山、观象山、小鱼山
- 小青岛、青岛湾、胶州湾东岸
- 八大关、花石楼、太平角
- 五四广场、五月的风、奥帆中心、浮山湾

从老城到东部新城可以连续步行，沿途经过海湾、山城高差、八大关林荫路和五四广场城市轴线。

## 快速启动

```bash
npm install
npm run dev
```

开发服务器监听 `0.0.0.0:5173`，已配置 `*.cosmoplat.cn`、`*.cosmoplat.com`、`*.cosmoplat.net` 访问。

生产构建与本地预览：

```bash
npm run build
npm run preview
```

如果浏览器 WebGPU 初始化失败，可用 `?webgl=1` 强制走 WebGL2 后端，TSL 材质逻辑保持一致：

```
http://localhost:5173/?webgl=1
```

## 操作

- `W A S D` / 方向键：步行
- `Shift`：加速
- 鼠标：第一人称视角；点击画面锁定鼠标，`Esc` 释放
- `V`：第一人称 / 第三人称切换
- 右侧面板：时间滑杆、五档光线预设、街道检索、地标传送
- `自动巡游`：镜头沿栈桥、教堂、总督府、信号山、小青岛、八大关、五四广场、奥帆中心自动运镜

## 技术方案

### 1. 地理数据与高程

`src/core/geo.ts`

- OSM 经纬度通过 Web Mercator 投影到米制局部坐标，原点取区域中心，避免大坐标浮点抖动。
- 海岸线按端点拼接为连续链，裁剪到区域矩形，构建外海、胶州湾与内湾水域多边形。
- 陆地以区域矩形为外轮廓，水域作为孔洞三角化；海岸线细节由原始 OSM 折线保留。
- 地形高度优先使用真实 DEM：AWS Terrarium z=15 瓦片，生成 1240 × 578 网格（8 m 间距，Int16，比例 10），双线性采样。
- 无 DEM 时回退到解析地形：基础高程 + 真实山丘高斯隆起 + 低频噪声。
- 小青岛在 DEM 中接近海平面，用局部隆起补足高程；建筑、道路、角色、树木、灯光都从同一高度函数采样。

### 2. 数据预处理

`scripts/prepare-osm.mjs`

- 使用 `osmtogeojson` 把 Overpass JSON 转成 GeoJSON，保留建筑、道路、海岸线、水域、码头、绿地、沙滩和景点等要素。
- 支持 Polygon 与 MultiPolygon；关系型 multipolygon 的内环会保留为建筑孔洞，用于内院、天井和带洞屋顶。
- 闭合海岸线多边形拆成 LineString，复用统一的海岸拼接逻辑。
- 输出 `public/data/qingdao-city.geojson`，当前约 9800 个要素、5600 余栋建筑、600 余条街道。

`scripts/fetch-dem.mjs`

- 下载并拼接 AWS Terrarium DEM 瓦片，生成 `public/data/qingdao-dem.bin` 与 `qingdao-dem.json`。
- 当前高程范围 0–141.9 m，信号山约 87.5 m，五四广场约 15.4 m，奥帆中心约 4.1 m。

### 3. 运行时几何生成

`src/generate/`

- 建筑：OSM 轮廓 `earcut` 三角化 → 墙体挤出 → 屋顶生成。
  - 高度优先读取 `height` / `building:levels`，缺失时按建筑类型估算。
  - 老城与八大关按轮廓填充率、跨度生成红瓦坡屋顶；带内环的建筑同时生成内院墙体和带洞屋顶。
  - 教堂附加双塔与尖顶，回澜阁附加八角屋顶，小青岛灯塔单独生成，花石楼附加石塔与红锥顶。
  - 五四广场的“五月的风”使用手工螺旋管体与放射网格广场表现，避开 OSM 薄壳体块对视线的遮挡。
- 道路：OSM 中心线重采样，按 `highway` 等级映射宽度，生成随地形起伏的条带网格，并在着色器中叠加车道线、人行道和石板铺装。
- 地形：陆地孔洞三角化后按 52 m 目标边长细分；每个三角面独立细分预算，避免大范围数据下出现跨城巨型三角形。
- 水面：独立海平面，着色器内做多频波浪、菲涅耳、太阳/月光高光和城市辉光。
- 绿地、沙滩、栈桥面、栏杆、树木、路灯同样由数据实时生成；八大关和滨海公园增加了树木密度。

### 4. TSL 程序化材质

`src/materials/`

- 建筑：TSL 片元着色器模拟窗格、窗框、墙面斑驳、勒脚、檐口、夜间窗灯与底层商铺灯。
- 道路：程序化沥青、石板、车道虚线、边线、人行道。
- 水面：无贴图的多频波浪与高光。
- 天空：方向渐变、太阳、月亮、星空、城市光污染地平线。
- 地形/绿地：噪声混合草地、泥土、岩石。
- 所有材质只依赖坐标与 uniform，不加载外部图片纹理。

### 5. 昼夜系统

`src/systems/timeOfDay.ts`

- 时间 0–24 连续可调，太阳方位与高度由时间解析计算。
- 五档预设：清晨、正午、黄金时刻、蓝调、夜晚。
- 关键帧插值天空、雾、太阳色温、半球光、水色、曝光和 Bloom 强度。
- 夜间窗灯比例按建筑随机分布，五四广场雕塑与广场灯在夜间增强。

### 6. 交互与碰撞

`src/systems/player.ts`

- 第一人称与第三人称共用角色状态；第三人称有程序化角色模型。
- 建筑轮廓与空间哈希做圆形碰撞，X/Z 分轴移动实现贴墙滑动。
- 碰撞体支持带洞建筑：内院可行走，内院墙体和外轮廓都能阻挡。
- 地面高度实时采样，栈桥面与陆地分别取高。
- 水域不可行走；传送与街道跳转会自动寻找最近可行走点。
- 街道检索按名称包含匹配，点击后定位到离当前位置最近的街道点。

### 7. 性能

- 建筑按 420 m 网格分块合并，保留视锥裁剪；当前 199 个建筑块、约 5600 栋建筑。
- 树木、路灯使用 InstancedMesh。
- 当前约 99 万三角形（地形约 30 万），45–75 次 draw call，随视锥变化。
- 单方向光阴影跟随玩家，阴影相机范围 300 m，2048 阴影贴图。
- 像素比默认限制在 1.6，避免高分屏过采样。

## 目录结构

```
public/data/qingdao-city.geojson      OSM 扩展区域数据（ODbL）
public/data/qingdao-dem.bin           DEM 高程网格
public/data/qingdao-dem.json          DEM 网格元数据
scripts/prepare-osm.mjs               Overpass JSON → GeoJSON
scripts/fetch-dem.mjs                 Terrarium DEM → 局部高程网格
scripts/overpass-query.txt            Overpass 查询语句
src/core/geo.ts                       投影、海岸线、水域、DEM、地形高度
src/world/loadWorld.ts                OSM 要素解析、分类与孔洞
src/generate/                         建筑、道路、地形、树木、路灯、地标
src/materials/                        TSL 材质
src/systems/                          玩家、相机巡游、昼夜
src/ui.ts                             HUD 交互
src/main.ts                           场景装配与渲染循环
```

## 数据来源与许可

地理数据来自 OpenStreetMap，通过 Overpass API 获取，许可为 ODbL 1.0：

- © OpenStreetMap contributors
- https://www.openstreetmap.org
- https://opendatacommons.org/licenses/odbl/

高程数据来自 AWS Open Data 的 Terrarium DEM 瓦片，底层为 Mapzen Terrain Tiles：

- https://registry.opendata.aws/terrain-tiles/
- https://github.com/tilezen/joerd

重新生成数据：

```bash
# 使用 scripts/overpass-query.txt 请求 Overpass，保存为 raw.json
node scripts/prepare-osm.mjs raw.json public/data/qingdao-city.geojson

# 重新下载并生成 DEM 网格
node scripts/fetch-dem.mjs
```

## MVP 边界与后续方向

当前版本聚焦“可步行、可识别、可切换昼夜”的完整闭环，以下能力留给后续迭代：

- 建筑立面细节、店招、街道家具与实时车流/行人。
- 更细的 LOD、GPU 遮挡剔除与分区流式加载。
- 天气、潮汐、海雾与更完整的夜景照明。
- 移动端性能档位与触控操作。
- 更多片区的 OSM 数据扩展与地标精细化。
