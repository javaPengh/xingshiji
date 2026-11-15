# 行食记 iOS 个人安装

本项目使用根目录共用前端和 `ios` 原生工程。当前包含 Core Motion 计步、SQLite 本机记录与 Keychain 登录信息保存；安卓与 PWA 的原生能力分别适配。

## 云端构建

拉取并安装依赖后，先按根目录 README 配置自己的 HTTPS 服务地址。云构建前修改工作流的 `VITE_API_BASE_URL`，再在 Actions 手动运行 **Build Xingshiji iOS (unsigned)**。依赖由 `package-lock.json` 固定，工作流使用 macOS 与 Xcode，上传代码不会自行触发构建。工作流内的 `VITE_API_BASE_URL` 为手机连接的 HTTPS 地址；没有注入账号或服务器凭据。

成功后下载 `xingshiji-unsigned-编号`，解压取得 `xingshiji-unsigned.ipa`、SHA-256 校验文件、`build-info.json` 和 Xcode 日志。未签名 IPA 需要再签名，不能直接作为已安装版本使用。

## Windows 签名与续签

在 Windows 安装 Sideloadly，使用它给本项目 IPA 签名并安装到 iPhone。Apple 账号、密码和验证码由用户在工具内输入，不保存在仓库、聊天或工作流中。个人签名需要定期续签；自动续签以设备和工具的实际配置为准。

产品名为“行食记”，Bundle ID 仍为 `local.xiaoka.diary`，以延续原 App 身份。升级时沿用原签名账号与安装方式；操作前先确认同步并导出备份。最终数据保留及覆盖安装效果需要在设备上验证。

## 验收

检查显示名称、登录保持、原日记、拍照分析、身体资料、自动步数及运动详情。断网新增记录并重开应保留，恢复联网后同步且不重复。Windows 结构检查和网页构建不能替代这些设备检查。
