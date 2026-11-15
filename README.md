# 行食记 · xingshiji

当前版本 **0.5.0**。包含 Node.js 服务端、共用 React 前端、iOS App 和 PWA；安卓原生工程尚未实现。

各电脑拉取同一个仓库，根据用途完成下面的服务端或客户端步骤。文档中的 `your-domain.example` 是占位地址，使用前必须替换为自己部署的服务地址。

## 一、拉取项目与准备环境

安装 Git、Node.js 和 npm。Node.js 需要 **24.22.1 或以上**，推荐使用与仓库构建流程一致的 24.22.1。

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
| Windows 运行包构建 | Windows、Python 3，并确保命令行能运行 `python.exe` |
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

这表示将数据保存在当前项目根目录下的 `data` 文件夹。**它是可修改的示例，不要求某个盘符或固定路径。** 正式部署建议将其改为自己选择的、位于源码和运行包目录之外的绝对路径，以便更换代码时继续使用同一份数据。

- 不必提前手动创建空目录：首次启动时，程序会递归创建目录、服务身份文件和 SQLite 数据库，运行账号需要有创建与写入权限。
- 也可以先手动创建目录、配置目录权限，再将路径写入 `DATA_DIR`。
- 使用相对路径时，源码启动相对于项目根目录；运行包启动相对于解压后的程序根目录。
- 已有服务升级时应沿用原 `DATA_DIR`。修改路径不会自动搬迁旧数据；需要搬迁时使用升级工具。

账号、日记、照片、备份和诊断资料都属于持久数据，不提交到 Git。`.env` 也只保存在部署环境。

### 3. 构建并启动

```powershell
npm run check
npm run build
npm run server
```

保持服务进程运行。在同一台电脑的浏览器打开 `http://127.0.0.1:4318`，注册账号并登录。另开终端检查服务：

```powershell
Invoke-RestMethod http://127.0.0.1:4318/api/health
```

返回 `ok: true` 和当前版本号表示 HTTP 服务已启动；它不代表模型和手机网络也已验证。可分别检查文字聊天和拍照分析。

### 4. 提供手机与其他电脑访问

将自己管理的可信 HTTPS 地址通过反向代理转发到后端，例如转发至本机 `http://127.0.0.1:4318`。域名、证书和代理由部署环境配置，项目不会自动申请公网地址。

将这个 HTTPS 地址填入服务端 `.env` 的 `PUBLIC_ORIGIN`，重启服务，再用于客户端构建。手机上的 `127.0.0.1` 指向手机自身，不能作为另一台电脑的服务地址。

`npm run server` 在前台运行，关闭进程就会停止服务。长期部署时，根据操作系统将它交给服务管理器或启动任务管理。

## 三、客户端：拉取后开发和调试

客户端使用同一个仓库的 `src`，需要连接一个服务端。可在本机启动开发后端，也可以连接已部署的远程后端。

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

## 四、可选：构建 Windows 独立运行包

如果部署电脑直接按第二节从源码运行，可以不打包。需要给另一台 Windows 电脑交付可直接运行的程序时，在装好 Node.js、依赖和 Python 3 的 Windows 构建电脑执行：

```powershell
npm run check
npm run windows:package
```

生成 `build/windows/xingshiji-server-版本-时间戳/`、同名 ZIP 和 `.zip.sha256`。包内包含 Node、依赖、后端、网页、知识库和升级工具；部署电脑无需再安装 Node.js 或 npm，但 AI 功能仍需可连接的 Ollama。

在全新的部署电脑上：

1. 核对 ZIP 的 SHA-256，解压并进入程序目录。
2. 复制包内 `.env.example` 为 `.env`，按第二节设置自己的数据目录、模型服务和 HTTPS 地址。
3. 执行 `node.exe scripts/check-nutrition-runtime.mjs --verify-only` 检查包完整性。
4. 双击 `START-SERVER.cmd`，首次启动会创建配置的数据目录和数据库。

也可以在 Actions 手动运行 **Build Xingshiji Windows server** 下载 ZIP。推送源码不会自动构建或部署。

## 五、已有部署如何更新

**从源码部署**：先停止服务、备份持久数据，保持原 `.env` 和 `DATA_DIR`，然后在项目根目录执行：

```powershell
git pull --ff-only
npm ci --no-audit --no-fund
npm run check
npm run build
npm run server
```

PWA 同域部署时，仍需确保 `VITE_API_BASE_URL` 留空。源码更新不应覆盖部署环境的 `.env` 或删除持久数据。

**使用 Windows 运行包部署**：新包解压到新的程序目录，停止旧服务，在新目录运行升级工具。以下两个占位参数必须替换为实际绝对路径：

```powershell
.\node.exe scripts/check-nutrition-runtime.mjs --verify-only
.\node.exe scripts/upgrade-from.mjs "<旧程序绝对路径>" --data-dir "<持久化数据目录绝对路径>"
```

升级工具沿用原配置、核对数据库并保存升级前快照；已使用指定数据目录时直接复用，需要迁移时执行校验后的复制。随后运行新目录的 `START-SERVER.cmd` 并核对原账号和记录。已有部署不要先用示例配置覆盖 `.env`，也不要靠“跳过同名文件”完成升级。

更多检查与回退说明见 [运行包升级说明](docs/NUTRITION_UPGRADE.md)。

## 六、代码目录与常用命令

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
| `npm run server` | 按 `.env` 启动后端 |
| `npm run build` | 生成 PWA 的 `dist` |
| `npm run ios:sync` | 生成并同步 iOS 网页及原生配置 |
| `npm run ios:check` | 检查 iOS 工程结构 |
| `npm run windows:package` | 生成 Windows 独立运行包 |

`node_modules`、`dist`、`build`、`.cache`、真实配置和数据不提交到 Git。不设 `test` 目录，运行包校验样例在 `scripts/fixtures`。`knowledge` 的只读 SQLite 索引属于运行输入，需要保留；`.gitattributes` 保持知识库原始字节，避免换行转换破坏校验。正常构建不需要原始研究资料；研究级原文校验或重建需设置 `XINGSHIJI_RESEARCH_DIR` 指向相应研究资料。

显示名称为“行食记”。为兼容已有 App、离线资料和备份，Bundle ID `local.xiaoka.diary`、持久化键与协议中的旧标识继续保留。
