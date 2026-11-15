# 行食记 · xingshiji

当前版本 **0.5.0**。饮食日记、拍照识别、身体资料、营养计划、AI 运动记录及 iOS 自动计步。

统一开发根目录：`D:\ProgramData\PythonProject\chatgpt_workspace\xiaokajiankang\xingshiji`。

## 目录与维护方式

```text
xingshiji/
├─ src/          共用 React / TypeScript 前端和离线同步
├─ PWA/          网页静态资源、安装清单、离线缓存和图标
├─ ios/          Capacitor iOS 工程，含计步、SQLite 和 Keychain 桥
├─ android/      安卓工程预留目录，目前尚未实现
├─ server/       Node.js 后端，按账号保存与同步数据、调用 Ollama
├─ shared/       前后端共享协议、校验、默认食物和计算逻辑
├─ knowledge/    结构化营养知识及受清单校验的只读索引
├─ scripts/      构建、运行包校验、升级及诊断工具
├─ docs/         安装与专项升级说明
├─ .github/      iOS 和 Windows 手动构建工作流
├─ .gitignore
└─ README.md
```

所有平台复用 `src`。`PWA` 是 Vite 的 `publicDir`，构建后内容进入 `dist`，不是另一套前端。iOS 工程内部的 `ios/App/App/public` 是 Capacitor 自动生成目录，保留其标准名称，不直接维护。

按要求不设 `test` 目录。`scripts/fixtures` 仅保存运行包自检和食物库整理需要的合成样例或公开参考数据。

显示名称已改为“行食记”。为读取已有离线资料、账号和备份，Bundle ID `local.xiaoka.diary`、持久化键和协议中的 `xiaoka` 标识保留兼容，不能只做全局替换。

## 环境与本地开发

需要 Node.js **24.22.1 或以上**、npm；Windows 打包另需可从命令行运行的 Python 3。iOS 原生编译需要 macOS 和 Xcode 26 或以上，可使用仓库内的 GitHub Actions 工作流。

在根目录执行：

```powershell
npm ci --no-audit --no-fund
Copy-Item .env.example .env
npm run check
npm run build
npm run server
```

`.env.example` 使用本项目内独立的开发数据目录 `.cache/development-data`，不连接正式数据。打开 `http://127.0.0.1:4318`，账号模式下先注册开发账号。需要调试前端时，在另一终端运行 `npm run dev`，访问 `http://127.0.0.1:5173`。

模型名称在各环境 `.env` 中配置；示例值不是对正式服务器实际配置的确认。文字对话、运动估算和计划使用 `OLLAMA_CHAT_MODEL`，拍照使用 `OLLAMA_VISION_MODEL`，后者需要具备图片理解能力。修改服务器配置后重启服务。

`npm run check` 校验 TypeScript、模块语法、目录及冻结知识库；`npm run knowledge:check` 单独校验运行知识库。正常构建直接使用已冻结知识库，不需要原研究资料。研究级原文验证或重建需另行设置 `XINGSHIJI_RESEARCH_DIR` 指向原 `analysis/knowledge` 资料，原始资料不随应用分发。

## Windows 后端打包

在 Windows 的本项目根目录执行：

```powershell
npm run check
npm run windows:package
```

输出到忽略的 `build/windows/xingshiji-server-0.5.0-时间戳/`，同时生成同名 `.zip` 和 `.zip.sha256`。包内包含 Node、后端、共享协议、编译后的网页、知识库、升级脚本和运行清单；不含真实 `.env`、账号、日记、照片或模型。

Windows 打包脚本会强制生成访问同域后端的网页，并隔离 iOS 构建变量。`dist` 是 PWA 产物，`build/web-ios` 是 iOS 网页产物；两者共用源码，输出互不覆盖。

也可在统一仓库 Actions 手动运行 **Build Xingshiji Windows server**，下载 Windows ZIP 及校验文件。上传源码本身不触发构建或部署。

## 正式服务器升级

开发电脑与正式服务器是两台电脑。正式数据固定在 **`D:\software_back\data`**，配置在实际运行目录的 `.env`。现有地址为 `https://desktop-7nla9nf.taila5d3f3.ts.net`；改名不自动更换服务器地址或 Tailscale 配置。

1. 在手机导出本机备份并确认同步状态；核对正式服务器实际运行目录、`.env` 和 `DATA_DIR`，停止旧服务。
2. 传输 ZIP 和校验文件，核对 SHA-256，解压到新的程序目录。不要在旧目录中使用“跳过同名文件”。
3. 在新程序目录执行以下命令。`旧服务绝对路径` 必须替换为刚核实的实际目录：

```powershell
.\node.exe scripts/check-nutrition-runtime.mjs --verify-only
.\node.exe scripts/upgrade-from.mjs "旧服务绝对路径" --data-dir "D:\software_back\data"
```

升级工具检查已有配置和数据库、保存升级前快照，并为新程序生成沿用原配置的 `.env`；固定数据目录已经存在时直接复用。升级已有服务时不要先把示例配置覆盖成 `.env`。首次全新安装才从包内 `.env.example` 创建配置。

4. 双击 `START-SERVER.cmd`。确认 Ollama 和原 HTTPS 转发仍运行，检查原账号、日记、照片及新功能。核对成功后以新目录启动服务，保留回退资料。

专项检查和回退方式见 [营养与运行包升级说明](docs/NUTRITION_UPGRADE.md)。不要在开发电脑上对服务器数据执行试验。

## iOS 构建与安装

统一仓库 Actions 手动运行 **Build Xingshiji iOS (unsigned)**。它安装锁定依赖、构建共用前端、同步原生资源、检查计步与存储桥，再用 Xcode 编译未签名 IPA。

下载 `xingshiji-unsigned-编号`，其中的 `xingshiji-unsigned.ipa` 由用户在 Windows 上通过 Sideloadly 签名安装或续签。构建工作流不需要 Apple 账号或签名证书。云构建可用额度取决于仓库与账号计划。

本地准备工程：

```powershell
$env:VITE_API_BASE_URL='https://desktop-7nla9nf.taila5d3f3.ts.net'
$env:VITE_AUTH_MODE='accounts'
npm run ios:sync
npm run ios:check
```

`ios:sync` 默认使用现有 HTTPS 服务地址，将网页构建到 `build/web-ios` 后同步进 iOS 工程，不覆盖 PWA 的 `dist`。在 Mac 上完成准备后运行 `bash scripts/package-ios.sh`，输出在 `build/ios/`。Windows 上的前端构建和结构检查不代表 Xcode 编译或真机验证。

详见 [iOS 个人安装说明](docs/IOS_PERSONAL_INSTALL.md)。

## PWA 部署

执行 `npm run build`，由后端托管生成的 `dist`；Windows 运行包已经包含该产物，不需要另外部署一套 PWA 服务器。通过可信 HTTPS 地址访问，在 iPhone Safari 中选择“添加到主屏幕”使用。网页更新后重新打开应用获取更新，清单与离线缓存由构建流程生成。

PWA 与安装版使用同一服务器账号；浏览器离线数据和原生离线数据各自保存，通过服务器同步。现有 Core Motion 计步插件属于原生 iOS 功能，PWA 不能直接调用；安卓计步和原生存储桥尚需实现。

## Git 与迁移来源

本目录保留原 iOS 仓库提交历史，并整合迁移时尚未提交的最新客户端改动；后端和知识库来自原开发源码，已核对后端与最新固定 Windows 运行包一致。原 `../app`、旧运行包及远端仓库均保留。

统一仓库：[javaPengh/xingshiji](https://github.com/javaPengh/xingshiji)，对应本地 `origin`。本地 `legacy-ios` 远端仅用于查看旧 iOS 仓库，推送地址已禁用；后续在本根目录提交源码并推送到 `origin/main`，不再向旧 iOS 仓库同步代码。

源码纳入 Git；`node_modules`、`dist`、`build`、真实配置、正式数据、日志和签名文件由 `.gitignore` 排除。`knowledge` 内清单引用的只读 SQLite 索引是运行输入，需要保留。不要把整个开发数据目录或旧运行包导入仓库。

`.gitattributes` 保留冻结知识库的原始字节，防止 Windows / macOS 换行转换破坏 SHA-256 校验；调整知识库内容后必须按完整研究与重建流程更新清单，不能只格式化文件。
