// Read-only service diagnosis. Run in a separate console from START-SERVER.cmd.
// Does not read account databases, .env, tokens, prompts, photos or chat content.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const target = new URL(process.argv[2] || 'http://127.0.0.1:4318/api/health');
if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || target.username || target.password)
  throw new Error('只允许检查本机HTTP健康接口。');
const port = Number(target.port || 80);
const outputDirectory = path.resolve(import.meta.dirname, '..', 'diagnostics', 'service');
const report = { format: 'xiaoka-local-service-check', version: 1, createdAt: new Date().toISOString(),
  target: target.href, host: { platform: os.platform(), logicalCpus: os.cpus().length, totalMemoryMb: Math.round(os.totalmem() / 1048576), freeMemoryMb: Math.round(os.freemem() / 1048576) },
  processes: null, ollama: null, probes: [] };
console.log('只读诊断开始；请保持原服务窗口原状。本工具不修改配置、不重启进程、不运行模型生成。');
console.log('1/3 检查端口与进程（最长约8秒）…');
if (os.platform() === 'win32') {
  const ps = `
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $ErrorActionPreference = 'Stop'
    $listener = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    $details = $null
    if ($listener) {
      $ownerId = $listener.OwningProcess
      $first = Get-Process -Id $ownerId
      $initialCpu = $first.CPU
      Start-Sleep -Milliseconds 1000
      $last = Get-Process -Id $ownerId
      $executable = $null
      try { $executable = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $ownerId)).ExecutablePath } catch {}
      $details = [ordered]@{pid=$ownerId;name=$last.ProcessName;executable=$executable;cpuSecondsDuringSample=[math]::Round(($last.CPU-$initialCpu),3);workingSetMb=[math]::Round($last.WorkingSet64/1MB);privateMemoryMb=[math]::Round($last.PrivateMemorySize64/1MB);responding=$last.Responding;sampleNote='约1秒采样，CPU秒数接近1代表约一个逻辑核心忙碌；Responding并非HTTP健康状态'}
    }
    $models = @(Get-Process | Where-Object { $_.ProcessName -like 'ollama*' } | ForEach-Object { [ordered]@{pid=$_.Id;name=$_.ProcessName;workingSetMb=[math]::Round($_.WorkingSet64/1MB);privateMemoryMb=[math]::Round($_.PrivateMemorySize64/1MB)} })
    [ordered]@{listenerFound=[bool]$listener;service=$details;ollamaProcesses=$models} | ConvertTo-Json -Depth 5 -Compress
  `;
  try { report.processes = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 8000, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).replace(/^\uFEFF/, '').trim()); }
  catch (error) { report.processes = { error: error.code || '进程信息读取失败或超时' }; }
} else report.processes = { note: '非Windows，跳过端口进程查询' };

console.log('2/3 连续3次本机健康检查（每次最多3秒）…');
for (let i = 1; i <= 3; i++) {
  const started = Date.now();
  try {
    const response = await fetch(target, { signal: AbortSignal.timeout(3000), cache: 'no-store' });
    const body = await response.json();
    const item = { attempt: i, at: new Date().toISOString(), durationMs: Date.now() - started, httpStatus: response.status, ok: response.ok && body.ok === true, appVersion: body.version || null };
    report.probes.push(item); console.log(JSON.stringify(item));
  } catch (error) {
    const item = { attempt: i, at: new Date().toISOString(), durationMs: Date.now() - started, ok: false, error: error.name || 'Error', code: error.cause?.code || null };
    report.probes.push(item); console.log(JSON.stringify(item));
  }
}

console.log('3/3 读取已加载模型（ollama ps，最长约5秒，不生成）…');
try { report.ollama = { output: execFileSync('ollama', ['ps'], { timeout: 5000, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim().slice(0, 8000) }; }
catch (error) { report.ollama = { error: error.code || 'Ollama状态读取失败或超时' }; }
report.host.freeMemoryAfterMb = Math.round(os.freemem() / 1048576);
report.passed = report.probes.every(item => item.ok);
console.log(JSON.stringify(report, null, 2));
try {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const file = path.join(outputDirectory, 'local-service-' + Date.now() + '.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
  console.log('诊断报告：' + file);
} catch { console.log('报告文件未能保存，请保留上方输出。'); }
if (!report.passed) process.exitCode = 1;
