# ServerTop 运维 Runbook

本文档记录两种部署方式。仓库维护者当前这台 macOS 工作站使用 **launchd 原生部署**；
Linux 服务器使用 Docker Compose。部署前先确认目标机器，不要仅根据仓库中存在
`docker-compose.yml` 就推断当前实例运行在容器里。

## 当前 macOS 实例

| 项目 | 当前值 |
|---|---|
| 工作目录 | `/Volumes/shit/projects/servertop` |
| 进程管理 | 用户级 launchd LaunchAgent |
| launchd label | `dev.servertop` |
| plist | `~/Library/LaunchAgents/dev.servertop.plist` |
| 启动入口 | `node --env-file=.env.local server/dist/server/src/index.js` |
| 服务端口 | `3000`（实际值以 `.env.local` 为准） |
| 环境配置 | `.env.local`（被 Git 忽略，包含密钥，禁止输出或提交） |
| 页面布局 | `layout.json`（被 Git 忽略） |
| LLM 配置 | `llm.json`（被 Git 忽略） |
| 日志 | `~/Library/Logs/servertop.log` |

工作目录位于外接 USB 卷 `/Volumes/shit`。macOS TCC 默认禁止 launchd 启动的进程访问可移除卷，
因此必须在「系统设置 → 隐私与安全性 → 完全磁盘访问」中为上述 `node` 二进制授权（macOS 26 的
「文件和文件夹」面板不暴露「可移除卷」开关），否则进程会以 `EPERM uv_cwd` 退出。plist 直接调用 `node --env-file`，不经过 `sh`/`grep`，
这样只需给 `node` 一个二进制授权。升级 Node 版本后路径变化需重新授权。

采用原生进程是有意为之：它采集真实 macOS 主机指标，同时可以通过本机 Docker socket
列出 Docker Desktop 容器。若把 ServerTop 放入 Docker Desktop，CPU、内存、进程和网络等
指标会主要反映 Linux VM，而非原生 macOS。

### 发布新版本

在仓库根目录执行：

```bash
npm test --workspace server
npm run build
git diff --check
launchctl kickstart -k "gui/$(id -u)/dev.servertop"
```

`kickstart -k` 会终止旧进程并由已加载的 LaunchAgent 立即启动新进程，不需要手工 `kill`
或重新加载 plist。不要使用 `docker compose up` 更新这台机器上的现有实例。

### 发布后验证

```bash
launchctl print "gui/$(id -u)/dev.servertop" \
  | rg 'state =|pid =|last exit code|runs ='

lsof -nP -iTCP:3000 -sTCP:LISTEN
curl -fsS http://127.0.0.1:3000/api/auth/status
tail -n 30 "$HOME/Library/Logs/servertop.log"
```

验收标准：

- launchd 状态为 `running`，PID 与发布前不同；
- 3000 端口由新 Node 进程监听；
- `/api/auth/status` 返回 HTTP 200；
- 日志出现 `listening on :3000`，且没有紧随其后的启动错误；
- 浏览器刷新后能加载新版静态资源，WebSocket 能重新连接。

需要检查受保护 API 时，应从 `.env.local` 在本机临时读取 `ACCESS_TOKEN` 并换取 JWT；
不得把 token、JWT 或 prompt 正文打印到终端记录、聊天消息或 Git 文件中。

### GitHub Pages 构建隔离

GitHub Pages 使用 `/servertop/` 子路径，而本地 launchd 实例从站点根路径 `/` 提供前端。
两者必须使用不同的输出目录：

```bash
npm run build          # 本地/服务器：web/dist
npm run build:pages    # GitHub Pages：web/dist-pages
```

手动发布 `gh-pages` 时只能复制 `web/dist-pages`。不要给普通 `npm run build` 设置 Pages
base，也不要把 `web/dist-pages` 复制回 `web/dist`；否则本地首页会引用
`/servertop/assets/...` 并导致静态资源 404。Pages 构建后无需重启本地服务，因为它不会
改动本地部署目录。

### 常用诊断

```bash
# 服务状态
launchctl print "gui/$(id -u)/dev.servertop"

# 当前监听进程
lsof -nP -iTCP:3000 -sTCP:LISTEN

# 实时日志
tail -f "$HOME/Library/Logs/servertop.log"

# 确认 ServerTop 是否是 Docker 容器
docker compose ps -a
docker ps --filter name=servertop
```

如果 launchd job 尚未加载，可执行：

```bash
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.servertop.plist"
```

如果已经加载，不要重复 `bootstrap`；使用 `kickstart -k` 即可。

### 为什么 Docker 卡片里没有 ServerTop

这是当前部署方式下的预期行为。Docker 卡片通过 Docker API 展示真实容器；ServerTop
自身是宿主机上的 launchd/Node 进程，因此不会出现在容器列表中。它仍能展示
Docker Desktop 中的其他容器。

不要为了让 ServerTop “显示自己”而伪造一条容器记录。若确实要让它成为容器，需要先明确
接受监控对象从原生 macOS 变为 Docker Desktop Linux VM，并为 macOS 单独调整 Compose：
默认配置引用的 `/sys` 与 `/etc/os-release` 在 macOS 宿主机上不存在。

## Linux Docker 部署

Linux 主机继续使用仓库默认流程：

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=50 servertop
```

此模式下 ServerTop 本身是容器，因此会出现在 Docker 卡片中。Compose 中的 host PID、
host network、宿主根目录、`/sys`、Docker socket 与 `/etc/os-release` 挂载用于读取 Linux
宿主机指标，不能随意删除。详细说明见根目录 [`README.md`](../README.md)。
