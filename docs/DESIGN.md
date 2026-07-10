# ServerTop — 功能设计文档

> 一个轻量级的自托管服务器监控面板：在服务器上运行一个 Node.js 服务，
> 将本机运行状态发布为 Web 页面，可从任意远端浏览器打开、实时监视。
> UI 风格参考 [ServerCat](https://servercat.app/)。

- **版本**: v0.2（M1 已实现并发布：https://github.com/newbdez33/servertop ）
- **日期**: 2026-07-08 创建 · 2026-07-09 更新（新增分离模式部署，见 §6.5）
- **技术栈**: Node.js / Express（后端） · React + Tailwind CSS（前端） · WebSocket（实时推送）

---

## 1. 目标与非目标

### 1.1 目标

| # | 目标 | 说明 |
|---|------|------|
| G1 | 单机监控 | 采集并展示本机 CPU、内存、磁盘、网络、进程、Docker 等核心指标 |
| G2 | 远程访问 | 部署后通过浏览器远程打开，Token 认证保护 |
| G3 | 实时性 | 指标 2 秒级刷新，通过 WebSocket 推送，无需手动刷新页面 |
| G4 | 轻量 | 单进程部署、无外部数据库依赖、常驻内存 < 100MB |
| G5 | 美观 | ServerCat 风格的清爽仪表盘，支持浅色/深色主题 |
| G6 | 纯只读视图 | Web UI 仅做展示，**不含任何配置/管理入口**；所有配置在服务器端完成 |
| G7 | 平板适配 | UI 界面为**英文**、紧凑省空间，以 **iPad 横屏**（≥1024px）为主要显示目标 |

### 1.2 非目标（当前版本不做）

- ❌ Web UI 内的任何配置界面（添加服务器、设置页等）——配置全部通过服务器端环境变量/配置文件
- ❌ 多服务器聚合管理（规划到 M3，架构上预留）
- ❌ 长期历史数据持久化 / 时序数据库（M1 仅内存环形缓冲，保留最近 1 小时）
- ❌ SSH 远程执行命令、文件管理（ServerCat 有，本项目定位为只读监控）
- ❌ 用户体系 / 多租户（单 Token 即可）
- ❌ 多语言 i18n（Web UI 仅英文）

---

## 2. 系统架构

与 ServerCat 的「无 Agent、SSH 拉取」模式不同，本项目采用 **Agent 内嵌** 模式：
监控采集器和 Web 服务是同一个 Node 进程，直接部署在被监控的服务器上。

```
┌─────────────────────── 被监控服务器 ───────────────────────┐
│                                                            │
│  ┌──────────────── ServerTop (Node 单进程) ─────────────┐  │
│  │                                                       │  │
│  │  Collector ──▶ MetricsStore ──▶ Express API (REST)    │  │
│  │  (systeminformation,      (内存环形缓冲)  │            │  │
│  │   2s 采样)                          WebSocket 广播     │  │
│  │                                          │            │  │
│  │  Static ◀── React + Tailwind 构建产物 (dist/)          │  │
│  └───────────────────────┬───────────────────────────────┘  │
│                          │ :3000                            │
└──────────────────────────┼──────────────────────────────────┘
                           │ (建议经 Nginx/Caddy 反代 + HTTPS)
                  ┌────────▼────────┐
                  │  远端浏览器      │
                  │  React SPA      │
                  └─────────────────┘
```

### 2.1 模块划分

| 模块 | 职责 | 关键依赖 |
|------|------|----------|
| **Collector** | 定时（2s）采集系统指标；进程/磁盘等低频指标 5–10s 采集 | [`systeminformation`](https://systeminformation.io/) |
| **MetricsStore** | 内存环形缓冲区，保留最近 1h 快照（1800 点），支持按范围降采样读取 | 无（纯内存） |
| **API Server** | REST 接口 + 静态资源托管 + 认证中间件 | `express` |
| **WS Broadcaster** | 每次采样后向所有已认证连接广播最新快照 | `ws` |
| **Web 前端** | SPA 仪表盘，WebSocket 订阅 + REST 拉取历史 | `react`, `tailwindcss`, `vite` |

### 2.2 数据采集项（systeminformation 映射）

| 指标 | 采集函数 | 频率 |
|------|----------|------|
| CPU 总使用率 / 每核使用率 | `si.currentLoad()` | 2s |
| 负载均值 load 1/5/15 | `si.currentLoad().avgLoad` + `os.loadavg()` | 2s |
| 内存（used/free/cached/swap） | `si.mem()` | 2s |
| 网络吞吐（每接口 rx/tx 速率） | `si.networkStats()` | 2s |
| 磁盘分区容量 | `si.fsSize()` | 10s |
| 磁盘 IO | `si.disksIO()` | 10s（M2） |
| 进程列表 Top N | `si.processes()` | 5s |
| Docker 容器 | `si.dockerContainers(true)` | 5s（未装 Docker 自动隐藏） |
| 静态信息（OS/内核/CPU 型号/主机名） | `si.osInfo()`, `si.cpu()`, `si.system()` | 启动时一次 |
| CPU 温度 | `si.cpuTemperature()` | 10s（不可用时隐藏） |

---

## 3. 功能模块设计

### 3.1 概览仪表盘（单页应用，M1）

页面结构见 `preview/ui-preview.html`。**无侧栏**，单页全宽（100%）布局，界面文案全英文，
紧凑间距以适配 iPad 横屏。自上而下：

1. **顶栏**：品牌标识 + 服务器名 + Online 状态徽章 + OS/运行时间；右侧为刷新间隔徽章
   （只读展示，间隔由服务器端 `SAMPLE_INTERVAL` 配置）和主题切换按钮（浅色/深色，
   属客户端显示偏好，不算配置入口）
2. **指标卡片行**（4 张）：CPU、Memory、Disk（根分区）、Network，均带迷你趋势图
3. **CPU 区**：使用率历史面积图（实时滚动，悬停查看数值）+ 每核心使用率条形图
4. **内存 / 网络 / 磁盘区**：内存构成堆叠条 + 明细行；网络 down/up 双线图；磁盘分区用量条
5. **进程表**：按 CPU 排序 Top 8，可切换按内存排序
6. **Docker 容器 + 系统信息**：容器状态列表；主机静态信息卡

**响应式断点**：≥1024px（iPad 横屏/桌面）保持 8/4 双栏网格；<900px（iPad 竖屏及以下）
单栏堆叠；<700px 指标卡两列；<480px 全部单列。

### 3.2 状态与告警语义

| 状态 | 颜色 | 触发条件（默认阈值，可配置） |
|------|------|------------------------------|
| 正常 good | 绿 `#0ca30c` | — |
| 警告 warning | 黄 `#fab219` | CPU/内存 > 80%，磁盘 > 85% |
| 严重 critical | 红 `#d03b3b` | CPU/内存 > 95%，磁盘 > 95%，服务离线 |

规则：状态色永远 **图标/圆点 + 文字标签** 成对出现，不单靠颜色传达含义。
M2 增加浏览器通知（Notification API）与 Webhook 推送。

### 3.3 认证（M1）

- 服务端环境变量 `ACCESS_TOKEN` 定义访问令牌；未设置时启动报警告（仅建议内网使用）
- 前端登录页输入 Token → `POST /api/auth/login` 校验 → 签发短期 JWT 存 `localStorage`
- REST 请求带 `Authorization: Bearer <jwt>`；WebSocket 握手用 `?token=` 查询参数
- 认证失败统一 `401`，前端跳登录页；连续失败限速（`express-rate-limit`）

---

## 4. API 设计

Base URL: `/api`，全部 JSON，除 `auth/login` 外均需认证。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/login` | Body `{ token }` → `{ jwt, expiresIn }` |
| GET | `/system` | 静态信息：主机名、OS、内核、CPU 型号/核数、总内存、磁盘列表、IP |
| GET | `/metrics` | 当前指标快照（结构见下） |
| GET | `/metrics/history?range=5m\|1h&step=2s\|10s` | 历史快照数组（服务端降采样） |
| GET | `/processes?sort=cpu\|mem&limit=10` | 进程 Top N |
| GET | `/docker` | 容器列表；Docker 不可用时 `{ available: false }` |
| WS | `/ws?token=` | 每 2s 推送 `{ type: "metrics", data: <快照> }` |

### 4.1 指标快照结构

```jsonc
{
  "ts": 1751871234000,
  "cpu":  { "usage": 32.4, "perCore": [41, 28, ...], "load": [1.24, 0.98, 0.76], "tempC": 52 },
  "mem":  { "total": 17179869184, "used": 10790000000, "cached": 3220000000,
            "free": 3160000000, "swapTotal": 2147483648, "swapUsed": 310000000 },
  "net":  [{ "iface": "eth0", "rxSec": 4404019, "txSec": 1153433,
             "rxTotal": 927712935936, "txTotal": 231928233984 }],
  "disk": [{ "mount": "/", "fs": "/dev/vda1", "size": 472446402560,
             "used": 335007449088, "usedPct": 70.9 }],
  "uptimeSec": 3648360
}
```

---

## 5. 前端设计

### 5.1 技术选型

- **React 18 + Vite + Tailwind CSS + TypeScript**（前后端统一 TS 严格模式，
  指标数据结构以共享类型定义，前后端同一来源）
- **图表**：自绘轻量 SVG 组件（面积图/折线图/条形图，与 preview 一致），零图表库依赖；
  若后续需要缩放/刷选等复杂交互，再评估引入 `recharts`
- **状态管理**：React hooks 即可（单页、数据单向流），不引入 Redux
- **实时数据**：`useMetricsSocket()` hook 封装 WebSocket（自动重连、指数退避），
  断线时降级为 5s REST 轮询并在顶栏显示 "Disconnected" 徽章

### 5.2 组件结构

```
src/
├── App.tsx                  # 路由：/login, /
├── layouts/AppShell.tsx     # 顶栏 + 内容网格（无侧栏）
├── components/
│   ├── TopBar.tsx           # 品牌 / 状态徽章 / 刷新间隔 / 主题切换
│   ├── StatTile.tsx         # 指标卡片（大数字 + 迷你趋势）
│   ├── charts/AreaChart.tsx # 单序列面积图（crosshair + tooltip）
│   ├── charts/LineChart.tsx # 多序列折线（图例 + 端点标注）
│   ├── charts/BarList.tsx   # 水平条列表（每核 CPU / 磁盘分区）
│   ├── charts/StackedBar.tsx# 内存构成堆叠条
│   ├── ProcessTable.tsx
│   ├── ContainerList.tsx
│   └── StatusPill.tsx       # 圆点 + 文字状态徽章
└── hooks/
    ├── useMetricsSocket.ts
    ├── useHistory.ts        # REST 拉取 + 与实时流拼接
    └── useTheme.ts          # 跟随系统 + 手动覆盖，持久化 localStorage
```

### 5.3 视觉规范（与 preview 一致）

- **语言**：界面文案仅英文，不做 i18n
- **布局**：全宽 100%、紧凑密度（小间距、小字号），iPad 横屏优先
- **主题**：浅色/深色双主题，token 化 CSS 变量，默认跟随系统
- **字体**：UI 用 Avenir Next / Segoe UI 栈；数值一律等宽字体 + `tabular-nums`
- **配色**：**Violet 方案**（已选定）——石墨紫灰中性色；序列 1 紫罗兰
  `#4a3aa7`(浅)/`#9085e9`(深)，序列 2 青绿 `#1baf7a`/`#199e70`，UI 强调色
  `#5142c0`(浅)/`#9085e9`(深)（已通过色盲安全/对比度校验，完整 token 见 preview）；
  状态色（绿/黄/红）固定，不随主题与配色方案变化
- **图表规范**：细线 2px、柔和网格线、≥2 序列必带图例、悬停十字线 + tooltip
  （生产版需为触屏补充 touch 事件支持）

---

## 6. 部署与运维（仅 Docker 部署）

本项目**只以 Docker 方式交付部署**。监控 agent 需要"看穿"容器隔离读取宿主机指标，
因此 compose 中的特权配置是功能必需项，不是可选优化。

### 6.1 镜像

- 多阶段构建：`node:22-slim` 构建（vite build + server 依赖安装）→ `node:22-slim` 运行
- **不用 Alpine**：busybox 版 `df`/`ps` 等命令会影响 `systeminformation` 部分指标读数
- 单镜像同时包含 Express 后端与前端静态产物

### 6.2 docker-compose.yml（模板）

```yaml
services:
  servertop:
    build: .
    restart: unless-stopped
    pid: host                # 宿主机进程列表
    network_mode: host       # 宿主机网卡流量 + 直接监听端口（无需 ports 映射）
    environment:
      - ACCESS_TOKEN=change-me
      - PORT=3000
    volumes:
      - /:/host:ro,rslave                              # 磁盘分区容量
      - /sys:/sys:ro                                   # CPU 温度
      - /var/run/docker.sock:/var/run/docker.sock:ro   # 容器列表
      - /etc/os-release:/etc/os-release:ro             # 宿主 OS 信息
```

### 6.3 容器内采集宿主指标的机制与适配

| 指标 | 机制 | 需要的配置 |
|------|------|-----------|
| CPU / 内存 / 负载 | `/proc/stat`、`/proc/meminfo`、`/proc/loadavg` 不被容器虚拟化，原生即宿主值 | 无 |
| 进程列表 | PID namespace | `pid: host` |
| 网卡流量 | network namespace | `network_mode: host` |
| 磁盘分区 | mount namespace | 挂载 `/:/host:ro,rslave`；**collector 层把 `/host` 前缀映射回 `/` 展示（M1 适配代码）** |
| Docker 容器 | Docker API | 只读挂载 docker.sock（等效 root 可见性；本服务只读 + Token 保护，可接受） |
| CPU 温度 | sysfs | 挂载 `/sys:ro` |
| 主机名 / OS | UTS namespace / 容器 rootfs | 挂载宿主 `/etc/os-release`；主机名经 env 或 `/host/etc/hostname` 读取 |

### 6.4 分离模式：GitHub Pages 前端 + HTTPS 后端（Caddy DNS-01）

Pages 页面是 HTTPS，浏览器混合内容策略要求后端也必须是 HTTPS。部署入口：

```bash
docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build
```

```
浏览器 ── HTTPS ──▶ GitHub Pages（gh-pages 分支，静态前端）
   │
   └── HTTPS/WSS ──▶ https://monitor.example.com（Caddy :443，DNS-01 签发证书）
                        └─▶ 127.0.0.1:3000（ServerTop 容器，host network）
```

**服务端**（`docker-compose.https.yml` + `deploy/caddy/`）：

- `ALLOWED_ORIGIN` 环境变量定义 CORS 白名单（逗号分隔）；未设置 = 仅同源。
  预检（OPTIONS）返回 204，命中白名单才回 `Access-Control-Allow-Origin` + `Vary: Origin`
- WS 升级校验 `Origin`：同主机或白名单内放行，否则 403（token 校验 401 在其后）
- `trust proxy: loopback`：仅信任本机 Caddy 的 `X-Forwarded-For`，登录限速按真实客户端 IP 计
- Caddy 镜像用 xcaddy 编译进 DNS 插件（构建参数 `DNS_PLUGIN`，默认 cloudflare）；
  `auto_https disable_redirects` 不占用宿主 :80（DNS-01 无需入站 HTTP），**:443 需空闲**；
  服务器保持内网，零公网暴露

**客户端**：

- 探测不到同源后端时，连接页出现 Server URL 输入框；地址存 localStorage
  （客户端连接配置，不属于服务端配置面）
- **Token 与签发服务器绑定**：切换服务器地址即清除本地 JWT，防止 token 泄露给新地址
- 远程会话顶栏始终有 Disconnect 按钮（含对端关闭认证的情况），可随时换服务器
- 在线演示为运行时参数 `?demo`（模拟数据，无后端）

**Pages 发布**：当前为手动构建（`VITE_BASE=/servertop/`）推送 `gh-pages` 分支；
`.github/pages.yml.disabled` 是备好的 Actions 自动部署工作流，待 gh token 补
`workflow` scope 后启用并把 Pages 切回 workflow 模式。

### 6.5 运行与升级

```bash
docker compose up -d --build      # 首次部署 / 本地构建升级
docker compose logs -f servertop  # 查看日志
```

- **配置项**（全部服务器端，Web UI 无任何配置界面）：环境变量 `PORT`、`ACCESS_TOKEN`、
  `SAMPLE_INTERVAL`（默认 2000ms）、`HISTORY_WINDOW`（默认 3600s）、`JWT_SECRET`（缺省随机生成）、
  `LAYOUT_FILE`（默认 `layout.json`）
- **仪表盘布局**：服务器端 JSON 文件（模板 `layout.example.json`）定义卡片集合/顺序/
  宽度（12 栅格 `span`）/列表行数（`limit`），经 `/api/system` 的 `layout` 字段下发，
  前端照单渲染；文件缺失或非法回退默认布局（仅告警不崩溃）；修改后重启生效
- **访问方式**：两种部署模式
  1. **同源模式**（默认）：容器同时托管前后端，内网/VPN 纯 HTTP 直连
  2. **分离模式**：前端托管在 GitHub Pages，后端经 Caddy（DNS-01 签发 Let's Encrypt
     证书，服务器保持内网、零入站端口）提供 HTTPS/WSS；后端以 `ALLOWED_ORIGIN`
     环境变量开启 CORS 白名单，WS 升级同样校验 Origin；前端的"服务器地址"存
     浏览器 localStorage（客户端连接配置，不属于服务端配置面）；
     部署见 `docker-compose.https.yml` + `deploy/caddy/`
- **注意**：在 macOS 的 Docker Desktop 中运行时读到的是 Linux VM 的指标，仅用于开发调试；
  生产目标为 Linux 服务器

### 6.1 目录结构

```
servertop/
├── docs/DESIGN.md           # 本文档
├── preview/ui-preview.html  # UI 静态预览（模拟数据）
├── Dockerfile               # 多阶段构建（node:22-slim）
├── docker-compose.yml       # 部署模板（pid/network host + 只读挂载）
├── server/                  # Express 后端（TypeScript）
│   ├── index.ts             # 入口：HTTP + WS
│   ├── collector.ts         # systeminformation 采集（含 /host 路径映射）
│   ├── store.ts             # 环形缓冲
│   ├── routes/              # REST 路由
│   └── auth.ts
├── shared/types.ts          # 前后端共享的指标类型定义
├── web/                     # React 前端（Vite + TS 工程）
└── package.json             # npm workspaces: server + web
```

---

## 7. 里程碑

| 阶段 | 内容 | 验收标准 |
|------|------|----------|
| **M1** | 核心监控（CPU/内存/磁盘/网络/进程/**Docker 容器**）、Token 认证、WS 实时推送、双主题 UI、Dockerfile + docker-compose.yml、`/host` 路径映射适配 | Linux 宿主机上 `docker compose up -d` 后远端浏览器打开，宿主指标（含磁盘分区、进程、网卡、容器列表）读数正确且 2s 自动刷新；断网重连；`curl` 无 Token 返回 401 |
| **M2** | CPU 温度、磁盘 IO、阈值告警 + 浏览器通知 + Webhook 推送、历史范围切换（5m/1h） | 阈值越限 10s 内出现告警徽章，并触发浏览器通知与 Webhook |
| **M3** | 多服务器聚合（每台跑 agent，数据源列表在面板服务端配置文件中定义）、SQLite 持久化 | 顶栏下拉可切换 ≥2 台服务器（数据源仍无 Web 配置入口） |

## 8. 风险与对策

| 风险 | 对策 |
|------|------|
| `systeminformation` 个别指标在某些发行版不可用（如温度） | 采集失败时返回 `null`，前端自动隐藏对应卡片 |
| 容器内磁盘挂载点显示为 `/host/...` | collector 层统一做路径前缀重写，展示为宿主真实挂载点 |
| Alpine/busybox 命令输出差异影响读数 | 基础镜像固定用 `node:22-slim`（Debian） |
| WS 长连接被反代超时断开 | 心跳 ping/pong（30s）+ 前端自动重连 |
| Token 泄露 | 支持随时更换 `ACCESS_TOKEN`；JWT 短有效期（24h）；限速防爆破 |
| 采集自身消耗资源 | 低频项降频采集；`processes()` 仅取 Top N 字段 |
