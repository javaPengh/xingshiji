param([switch]$Build)
$ErrorActionPreference = 'Stop'
$xingshijiAppRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $xingshijiAppRoot
$nodeVersion = & node.exe -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'24.22.1') { throw '需要 Node.js 24.22.1 或以上，请先配置 PATH。' }
$env:TEMP = Join-Path $xingshijiAppRoot '.cache\tmp'
$env:TMP = $env:TEMP
$env:NPM_CONFIG_CACHE = Join-Path $xingshijiAppRoot '.cache\npm'
$env:NPM_CONFIG_UPDATE_NOTIFIER = 'false'
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
if (-not (Test-Path -LiteralPath '.\node_modules')) { throw '请先在 xingshiji 根目录运行 npm ci 安装依赖。' }
if ($Build -or -not (Test-Path -LiteralPath '.\dist\index.html')) {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw '界面构建失败。' }
}
Write-Host '启动后请在浏览器打开 http://127.0.0.1:4318。保持此窗口打开。'
& node.exe --env-file-if-exists=.env server/index.mjs
exit $LASTEXITCODE
