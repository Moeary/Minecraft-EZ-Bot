# MC Bot Self

一个使用 Mineflayer 的自托管 Minecraft 多机器人控制项目。项目由 **Pixi** 固定 Node.js/npm 环境，支持纯 CLI 运行，也可以选择启用 React + TypeScript Web 控制台和 Prismarine 第三方视角。

## 项目结构

```text
apps/server/src/
  cli.js                 # CLI 入口
  config/load-config.js  # 本地配置加载与校验
  core/                  # 多机器人生命周期、命令与重连逻辑
  web/server.js          # HTTP API 与静态文件服务
apps/web/                # React + TypeScript + Vite 控制台
config/                  # 可提交的示例配置；*.local.json 不提交
scripts/                 # 检查、开发启动和 Pixi 环境保护脚本
data/auth/               # Microsoft 登录缓存，不提交
pixi.toml / pixi.lock    # 运行环境、任务和锁文件
```

## 首次安装

不要直接使用系统 Node.js 或 npm。仓库的 `preinstall` 会阻止非 Pixi 环境安装。

```powershell
Copy-Item config/bots.example.json config/bots.local.json
Copy-Item config/whitelist.example.json config/whitelist.local.json
pixi run install
pixi run check
```

编辑 `config/bots.local.json` 添加账号。`id` 是 CLI/Web 使用的稳定标识；每个启用 Viewer 的机器人必须分配不同端口。Microsoft 登录令牌会保存到忽略的 `data/auth/<bot-id>/`。

## Pixi 命令

```powershell
pixi run bot Yukikaze  # 只启动一个机器人和交互式 CLI
pixi run bots          # 启动所有 enabled 机器人
pixi run build         # 构建生产版 React UI
pixi run server        # 启动 API/已构建 UI，不强制自动启动机器人
pixi run dev           # 同时启动 API 与 Vite 开发服务器
pixi run check         # 检查后端 JS 和示例配置
pixi run npm audit --omit=dev # 检查生产依赖漏洞
```

生产 UI 默认访问 `http://127.0.0.1:3000`；开发 UI 默认访问 `http://127.0.0.1:5173`。在 `web.autoStart` 中填写机器人 ID，可让 Web 服务启动时自动连接，例如 `"autoStart": ["Yukikaze"]`。

## 控制功能

现有命令保持为：`status`、`stop`、`fish`、`kill on/off`、`home`、`sethome`、`come`、`follow` 和 `cmd`。游戏内聊天仍要求使用 `<机器人名|all> <命令>`，且发送者必须位于 `config/whitelist.local.json`。

Web UI 提供启动/停止、状态、攻击、钓鱼、停止动作、自由命令输入和第三方视角入口。Viewer 默认 `firstPerson: false`，每个在线机器人使用自己的端口。

## 安全说明

- `config/*.local.json`、`.env*`、`data/auth/`、日志和构建产物均被 `.gitignore` 排除。
- 示例配置只能使用占位地址、邮箱和玩家名；提交前运行 `git status --ignored` 检查。
- Web 默认只监听 `127.0.0.1`。不要直接把控制 API 或 Viewer 端口暴露到公网；远程访问应放在带身份验证和 TLS 的反向代理或 VPN 后面。
- `web.allowRawCommands` 控制 Web 是否允许 `cmd`。公开部署时建议保持 `false`。

