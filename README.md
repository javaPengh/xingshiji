# 行食记 · xingshiji

当前版本 **0.5.0**。包含 Node.js 服务端、共用 React 前端、iOS App 和 PWA；安卓原生工程尚未实现。

服务端和客户端源码统一维护在本 Git 仓库。服务端在拉取的项目目录中安装依赖、构建网页并运行；客户端在同一份源码上开发、构建 PWA 或 iOS App。文档中的 `your-domain.example` 是占位地址，使用前必须替换为自己部署的服务地址。

## 一、拉取项目与准备环境

安装 Git、Node.js 和 npm。Node.js 需要 **24.22.1 或以上**，推荐使用与仓库构建流程一致的 24.22.1。

Windows 可从 [Node.js 官方下载页](https://nodejs.org/en/download) 选择符合要求的 Node.js 24 LTS 安装程序。安装或升级后，重新打开终端并检查当前版本和路径：

```powershell
node --version
node -p "process.execPath"
where.exe node
```

如果启动时提示版本过低，以实际运行的版本和程序路径为准。`where.exe node` 显示多份程序时，需要让符合要求的 Node.js 优先被命中，也可使用其 `node.exe` 绝对路径启动。配置完成后再安装项目依赖。

在自己选择的工作目录执行：

```powershell
git clone https://github.com/javaPengh/xingshiji.git
cd xingshiji
npm ci --no-audit --no-fund
```

后续源码命令均在这个 `xingshiji` 根目录执行。

| 用途 | 额外环境 |
|---|---|
| 服务端 AI 功能 | 安装并运行 Ollama，准备文字模型和支持图片理解的视觉模型 |
| 网页与 PWA 开发 | 浏览器；调试时需要可连接的本地或远程服务端 |
| iOS 原生编译 | macOS、Xcode 26 或以上；Windows 可以准备工程并使用 GitHub Actions 云构建 |

## 二、服务端：从源码首次部署

### 1. 创建配置

完成拉取和依赖安装后，复制配置模板，再用编辑器修改 `.env`：

```powershell
Copy-Item .env.public.example .env
notepad .env
```

上面是 Windows PowerShell 命令；macOS / Linux 可用 `cp .env.public.example .env` 并使用自己的编辑器。

主要配置如下：

| 字段 | 配置方式 |
|---|---|
| `AUTH_MODE` | 使用 `accounts`，由用户注册、登录账号 |
| `HOST`、`PORT` | 默认 `127.0.0.1:4318`，适合由本机 HTTPS 反向代理转发 |
| `DATA_DIR` | 自己选择的持久化数据目录，详见下一节 |
| `OLLAMA_BASE_URL` | Ollama 的实际地址，本机默认 `http://127.0.0.1:11434` |
| `OLLAMA_CHAT_MODEL` | 已安装的文字模型名称，用于聊天、运动估算和计划 |
| `OLLAMA_VISION_MODEL` | 已安装且支持图片理解的模型名称，用于拍照识别 |
| `PUBLIC_ORIGIN` | 对外提供服务的 HTTPS 来源，例如 `https://your-domain.example`；仅本机调试时可留空 |
| `ALLOWED_ORIGINS` | 前端单独部署时额外允许的页面来源，多个地址用逗号分隔；同域网页无需额外填写 |

模板中的模型名称是示例。先安装并启动 [Ollama](https://docs.ollama.com/quickstart)，使用 `ollama pull 模型名称` 下载所选模型（将“模型名称”替换为准确名称），再用 `ollama list` 查看已安装模型并把实际名称填入 `.env`。仓库不包含模型，也不会在启动时自动下载模型；模型服务未准备好时，AI 功能无法使用。

### 2. 选择数据目录

生产配置模板默认写法为：

```ini
DATA_DIR=./data
```

这表示将数据保存在当前项目根目录下的 `data` 文件夹。正式部署建议填写自己选择的、位于项目目录之外的绝对路径，并确保该路径纳入数据备份。

- 不必提前手动创建空目录：首次启动时，程序会递归创建目录、服务身份文件和 SQLite 数据库，运行账号需要有创建与写入权限。
- 也可以先手动创建目录、配置目录权限，再将路径写入 `DATA_DIR`。
- 使用相对路径时，相对于项目根目录。
- 更新代码时沿用原 `DATA_DIR`。修改路径不会自动搬迁已有数据。

账号、日记、照片、备份和诊断资料都属于持久数据，不提交到 Git。`.env` 也只保存在部署环境。

### 3. 构建并启动

```powershell
npm run check
npm run build
node scripts/background-server.mjs start
node scripts/background-server.mjs status
```

以上为 Windows 后台启动方式，命令返回后服务继续运行，不保留 CMD 窗口。在同一台电脑的浏览器打开 `http://127.0.0.1:4318`，注册账号并登录。检查服务：

```powershell
Invoke-RestMethod http://127.0.0.1:4318/api/health
```

返回 `ok: true` 和当前版本号表示 HTTP 服务已启动；它不代表模型和手机网络也已验证。可分别检查文字聊天和拍照分析。

### 4. 后台管理与日志

Windows 也可以直接双击项目根目录的以下入口。启动入口会提示结果，关闭提示框后服务继续后台运行。

| Windows 入口 | 用途 |
|---|---|
| `START-SERVER.vbs` | 后台启动；重复点击不会启动第二个实例 |
| `STOP-SERVER.vbs` | 安全停止此目录启动的后台实例 |
| `SERVER-STATUS.vbs` | 查看运行状态、PID、地址和日志位置 |

后台服务的标准输出和错误统一追加到**项目根目录的 `logs/xingshiji.log`**，日志目录自动创建，`logs/` 已被 Git 忽略。后台状态保存在忽略的 `.cache/background`，服务运行时不要删除或手动修改该目录。

应用日志按行保存 JSON，照片节点保留 `[Photo]` 前缀。每条包含 `createdAt`（UTC 时间，末尾 `Z`）、`level`、`requestId`、`accountId`、`event` 和 `data`。`accountId` 是服务端验证的账号 ID；有效会话从接收请求起就带上该 ID，登录或注册成功后也会关联该账号。未登录、会话失效或系统任务的账号 ID 为 `null`，本机连接码模式为 `local`；系统任务的 `requestId` 为 `null`。同一次请求的访问日志、照片节点和 AI 失败诊断使用同一个 `requestId`，并通过响应头 `X-Request-Id` 返回；照片请求的 `X-Photo-Request-Id` 与其相同。日志不记录会话令牌、密码、请求正文或照片内容。

在 PowerShell 中查看日志：

```powershell
Get-Content ./logs/xingshiji.log -Tail 100 -Wait
```

按请求或账号查找时，将下面的占位值替换为实际 ID：

```powershell
Select-String -Path ./logs/xingshiji.log -SimpleMatch '实际请求ID'
Select-String -Path ./logs/xingshiji.log -SimpleMatch '实际账号ID'
```

按 `Ctrl+C` 结束日志查看，后台服务继续运行。停止服务使用：

```powershell
node scripts/background-server.mjs stop
```

双击入口需要 Windows Script Host；如果系统禁用了它，使用上述 Node 命令管理后台服务。目前需要在登录后手动启动，不自动配置开机启动或异常重启；注销或重启系统后需要再次启动。macOS / Linux 或前台调试可使用 `npm run server`，日志输出到当前终端。

### 5. 提供手机与其他电脑访问

将自己管理的可信 HTTPS 地址通过反向代理转发到后端，例如转发至本机 `http://127.0.0.1:4318`。域名、证书和代理由部署环境配置，项目不会自动申请公网地址。

将这个 HTTPS 地址填入服务端 `.env` 的 `PUBLIC_ORIGIN`，重启服务，再用于客户端构建。手机上的 `127.0.0.1` 指向手机自身，不能作为另一台电脑的服务地址。

## 三、客户端：拉取后开发和调试

客户端使用同一个仓库的 `src`，需要连接一个服务端。可在本机启动开发后端，也可以连接已部署的远程后端。

首次登录或本机尚无日记数据时会初始化下载。已有本机数据时，重新打开 App 或返回前台直接读取本机记录。新增、修改、删除记录和自动步数变化会触发同步；网络恢复时继续处理未完成的操作，空闲时不定时检查服务器。同步成功提示显示 3 秒后隐藏；需要主动获取其他设备的更新时，在设置的“本机存储与同步”点击“立即同步”。

### 方式 A：本机同时开发前后端

在新拉取、尚无 `.env` 的开发目录中执行：

```powershell
Copy-Item .env.example .env
npm run server
```

开发模板默认使用 `.cache/development-data` 保存开发数据，目录同样由程序自动创建。按需修改开发模型配置，不要把开发环境指向正式数据。

保持这个终端运行，另开终端进入同一项目目录：

```powershell
npm run dev
```

打开 `http://127.0.0.1:5173`。前端开发服务器会把 `/api` 请求转发到本机 `127.0.0.1:4318`。修改 `src` 后可在浏览器查看更新；后端代码修改后需要重启后端进程。

### 方式 B：只开发前端，连接远程服务

不需要在客户端电脑创建后端数据目录或启动 Ollama。在 PowerShell 中指定实际服务地址：

```powershell
$env:VITE_API_BASE_URL='https://your-domain.example'
$env:VITE_AUTH_MODE='accounts'
npm run dev
```

macOS / Linux 可使用：

```bash
VITE_API_BASE_URL=https://your-domain.example VITE_AUTH_MODE=accounts npm run dev
```

默认本机开发页面来源已被后端允许；使用其他域名或端口调试时，将对应页面来源加入服务端 `ALLOWED_ORIGINS` 并重启服务。

### PWA 构建与部署

PWA 与后端同域部署时，前端 API 地址应留空。若此前设置过远程前端开发地址，先清除该环境变量，并检查本地环境文件没有设置 `VITE_API_BASE_URL`：

```powershell
Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
npm run build
```

生成的 `dist` 由本项目后端托管。重启或更新服务后，通过自己的 HTTPS 服务地址访问，在 iPhone Safari 中选择“添加到主屏幕”即可使用 PWA。

PWA 与 iOS App 登录同一服务器账号即可同步资料，但两者的本机离线存储分别保存。PWA 无法直接调用现有 iOS Core Motion 计步插件。

### iOS 工程准备、构建与安装

在已安装依赖的客户端源码目录中，显式指定自己的 HTTPS 后端地址。PowerShell 示例：

```powershell
$env:VITE_API_BASE_URL='https://your-domain.example'
npm run ios:sync
npm run ios:check
```

macOS / Linux 示例：

```bash
export VITE_API_BASE_URL=https://your-domain.example
npm run ios:sync
npm run ios:check
```

`ios:sync` 构建共用前端到 `build/web-ios`，同步进 `ios` 工程，并准备计步权限、图标和存储桥；它不会覆盖 PWA 的 `dist`。构建前必须配置自己的服务地址，不依赖脚本中为已有安装保留的默认值。

在 Mac 上继续执行：

```bash
bash scripts/package-ios.sh
```

输出为 `build/ios/xingshiji-unsigned.ipa`。Windows 上可以准备和检查工程，但原生编译必须在 Mac 上完成。

使用云构建时：

1. 在自己的 GitHub 仓库中，将 `.github/workflows/ios-personal-unsigned.yml` 的 `VITE_API_BASE_URL` 改为实际 HTTPS 后端地址并提交。
2. 在 Actions 手动运行 **Build Xingshiji iOS (unsigned)**。
3. 下载 `xingshiji-unsigned-编号` 构建产物，取得 IPA 和构建日志。
4. 在 Windows 安装 Sideloadly，用自己的 Apple 账号签名安装或续签。仓库和工作流不保存 Apple 凭据。

云构建额度取决于仓库和账号计划。结构检查不等于 Xcode 编译或真机验证；安装后仍需检查登录、同步、拍照和计步。详见 [iOS 个人安装说明](docs/IOS_PERSONAL_INSTALL.md)。

## 四、服务端更新

在部署电脑的项目根目录操作。先停止后台服务，并备份 `DATA_DIR` 中的持久数据：

```powershell
node scripts/background-server.mjs stop
```

保留本机 `.env` 配置，拉取仓库、安装依赖、构建并启动：

```powershell
git pull --ff-only
npm ci --no-audit --no-fund
npm run check
Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
npm run build
node scripts/background-server.mjs start
node scripts/background-server.mjs status
```

这些是 Windows PowerShell 命令。PWA 同域部署时，环境文件中的 `VITE_API_BASE_URL` 也应留空。每条命令成功后再执行下一条；失败时先处理报错。更新后检查 `/api/health`、账号登录和日记数据，运行日志位于 `logs/xingshiji.log`。

`.env`、持久数据和运行日志不受 Git 更新管理。更新时不重新复制配置模板，不改变 `DATA_DIR`。向 GitHub 推送代码不会自动更新已运行的服务，也不会自动安装手机 App；iOS 客户端按第三节重新构建、签名安装。

## 五、代码目录与常用命令

```text
xingshiji/
├─ src/          共用前端与离线同步
├─ PWA/          静态资源、安装清单、离线缓存和图标
├─ ios/          iOS 原生工程、计步与存储桥
├─ android/      安卓工程预留目录，目前尚未实现
├─ server/       后端源码
├─ shared/       共享协议、校验、默认食物与计算
├─ knowledge/    结构化营养知识和只读索引
├─ scripts/      构建、校验、升级与诊断工具
├─ docs/         专项说明
└─ .github/      手动云构建工作流
```

| 命令 | 用途 |
|---|---|
| `npm run check` | TypeScript、模块语法、目录和冻结知识库检查 |
| `npm run knowledge:check` | 单独校验冻结运行知识库 |
| `npm run dev` | 启动前端开发服务器 |
| `npm run server` | 按 `.env` 在前台启动后端，便于开发调试 |
| `node scripts/background-server.mjs start` | Windows 后台启动服务 |
| `node scripts/background-server.mjs status` | 查看后台服务状态 |
| `node scripts/background-server.mjs stop` | 停止后台服务 |
| `npm run build` | 生成 PWA 的 `dist` |
| `npm run ios:sync` | 生成并同步 iOS 网页及原生配置 |
| `npm run ios:check` | 检查 iOS 工程结构 |

`node_modules` 保存安装的依赖，`dist` 保存 PWA 构建产物，`build` 保存客户端构建产物，`.cache` 保存开发缓存和后台状态。它们以及 `logs`、真实配置和数据均不提交到 Git。不设 `test` 目录，校验样例在 `scripts/fixtures`。`knowledge` 的只读 SQLite 索引属于运行输入，需要保留；`.gitattributes` 保持知识库原始字节，避免换行转换破坏校验。正常构建不需要原始研究资料；研究级原文校验或重建需设置 `XINGSHIJI_RESEARCH_DIR` 指向相应研究资料。

App 显示名称为“行食记”，Bundle ID 为 `local.xiaoka.diary`。Bundle ID、持久化键和备份协议是数据兼容性的一部分，不应随意修改。
