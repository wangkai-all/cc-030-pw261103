# 场站驻留研判台

在地图上导入场站 GeoJSON 围栏，从原始 GPS 轨迹自动计算车辆**进入时间、驻留时长与退出时间**。前端完全使用本地 SVG 绘制围栏、轨迹、缓冲与判定证据，**不依赖任何在线底图或在线字体服务**；后端使用 FastAPI + Shapely + pyproj。

## 功能

- **GeoJSON 围栏导入**：支持 `FeatureCollection`、`Feature`、`Polygon`、`MultiPolygon`；保留凹多边形、内部空洞与相互重叠的场站。
- **本地 SVG 地图**：平移、滚轮缩放、适应视图，米制网格、比例尺、10 m 缓冲轮廓、空洞斜线、信号中断虚线与进出触发点标注。
- **数据清洗**：按车辆与时间稳定排序；同一时刻同位置重复点去重；同一时刻位置冲突的整组点列为异常并剔除。
- **双点确认**：连续两个有效点均在围栏内且间隔 ≤ 60 s 才确认进入，时间回记第一个点，边界按内部处理。
- **10 m 滞回**：进入后，落在边界外 10 m 缓冲内的点保持原状态；连续两个点越出缓冲且间隔 ≤ 60 s，才在第一个越界点确认退出。
- **米制投影**：WGS 84 经纬度统一投影到以场站范围中心为原点的 AEQD 平面，距离与缓冲全部按米计算，绝不对经纬度直接做减法。
- **空洞与重叠**：空洞按场外处理且不享有 10 m 缓冲；重叠围栏逐座独立判定，不合并、不互相抵消。
- **信号断档**：相邻有效点间隔 ≥ 5 分钟即断开；已开始的驻留标记为**不完整**，正常尚未离开的标记为**进行中**，二者均不进入完整驻留平均时长。
- **判定过程可追溯**：选中任意驻留记录，地图定位进入/退出触发点及配对点；详情抽屉给出逐点分类、处置动作、证据点序号、事件时间线与规则标签。

## 快速启动

需要 Python 3.10+ 与 Node.js 18+。

```bash
# 1. 后端依赖
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt

# 2. 前端依赖
cd frontend
npm install --cache ../.npm-cache
cd ..
```

### 开发模式（前后端分别运行）

```bash
# 终端 1：API
.venv/bin/uvicorn backend.app.main:app --reload --port 8000

# 终端 2：Vite 开发服务器（/api、/docs 已代理到 8000）
cd frontend
npm run dev
```

打开 <http://localhost:5173>。

### 单服务运行（构建后由 FastAPI 托管）

```bash
cd frontend
npm run build
cd ..
.venv/bin/uvicorn backend.app.main:app --port 8000
```

打开 <http://localhost:8000>。构建产物 `frontend/dist` 存在时，FastAPI 会自动托管首页与 `/assets`；API 文档在 `/docs`。

### 测试

```bash
.venv/bin/python -m pytest backend/tests -q
```

测试覆盖进入回记、边界算内部、10 m 缓冲滞回、单点越界不退出、双点退出、空洞无滞回、5 分钟断档、不跨缺口、进行中、重复杂点/冲突点预处理、重叠围栏独立判定、凹多边形与 MultiPolygon，以及平均值排除不完整/进行中记录。

## 判定规则

| 规则 | 实现 |
| --- | --- |
| 进入 | `prev ∈ inside && curr ∈ inside && Δt ≤ 60 s`；记录从 `prev` 开始 |
| 场内状态 | `geom.covers(point)`，Shapely `covers` 包含外边界 |
| 滞回 | 进入后 `point ∈ buffer` 仍保持在场；缓冲为 `fence.buffer(10).difference(holes)` |
| 退出 | `prev ∉ {inside, buffer} && curr ∉ {inside, buffer} && Δt ≤ 60 s`；从 `prev` 记录退出 |
| 空洞 | 内环覆盖点分类为 `hole`，按场外；空洞区域不获得 10 m 缓冲 |
| 断档 | 相邻有效点 `Δt ≥ 300 s` 断开，已开始驻留以缺口前最后点结束并标记 `incomplete` |
| 进行中 | 轨迹结束仍在场内且未形成退出双点，标记 `ongoing` |
| 重叠 | 每条轨迹对每座围栏分别运行独立状态机 |
| 平均时长 | 仅 `complete` 驻留参与平均；`incomplete` 与 `ongoing` 仅展示 |

状态机细节位于 `backend/app/detection.py`，几何与投影位于 `backend/app/geo.py`。

## API

- `GET /api/health` — 健康检查。
- `GET /api/demo` — 内置四场景数据与完整分析结果（边界抖动、穿过空洞、信号中断、围栏重叠）。
- `POST /api/analyze` — `{ geojson, tracks, options? }`，返回围栏、轨迹、驻留记录、异常与统计。
- `POST /api/geojson/normalize` — 校验并返回投影后的围栏几何与 10 m 缓冲。

轨迹点格式：

```json
{
  "vehicle_id": "V-001",
  "label": "沪A·D2718",
  "points": [
    { "id": "p1", "timestamp": "2026-11-11T08:10:00+08:00", "lon": 121.8052, "lat": 30.9068 }
  ]
}
```

可调参数（`options`）：

```json
{
  "buffer_m": 10,
  "enter_confirm_seconds": 60,
  "exit_confirm_seconds": 60,
  "gap_break_seconds": 300
}
```

## 目录

```
backend/
  app/
    main.py        FastAPI 路由与静态托管
    models.py      请求模型与参数
    geo.py         GeoJSON 解析、AEQD 投影、缓冲与点分类
    detection.py   清洗、状态机、证据与统计
    demo.py        四个内置边界场景
    service.py     分析编排
  tests/           pytest 行为测试
frontend/
  src/
    App.tsx        场景切换、筛选、导入与详情联动
    components/    SVG 地图、详情抽屉、导入/质量/规则弹窗
    lib/           本地时间格式化与 API 客户端
    styles.css     本地视觉系统与响应式布局
```

## 实现说明

- 投影以全部围栏的联合边界中心建立 AEQD（`+proj=aeqd +units=m`），曲率影响在园区尺度内可忽略，但所有距离仍是真实米制。
- 邻接点分类使用投影后的 Shapely 几何；围栏几何在导入时执行 `make_valid` 并归一为面要素，空洞内环完整保留。
- 信号缺口不会参与任何双点确认；缺口前后的轨迹段分别独立判定。
- 前端不请求任何瓦片、地图 SDK 或在线字体；SVG、图形与系统字体全部本地渲染。
