/**
 * Build VaultAI Windows 安装包 without Wine/Electron NSIS.
 * Produces: release/VaultAI-Setup-VERSION-win-x64.zip
 * Contents: Node runtime + app + Install-VaultAI.ps1 + VaultAI-Setup.bat + Uninstall
 */
import { createWriteStream, existsSync, mkdirSync, cpSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const releaseDir = join(root, 'release');
const stage = join(releaseDir, `_stage-setup-${version}`);
const nodeVer = '20.19.2';
const nodeZipName = `node-v${nodeVer}-win-x64.zip`;
const nodeUrl = `https://nodejs.org/dist/v${nodeVer}/${nodeZipName}`;
const cacheDir = join(root, '.cache');
const nodeZipPath = join(cacheDir, nodeZipName);

mkdirSync(releaseDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });

async function download(url, dest) {
  if (existsSync(dest) && (await import('node:fs')).statSync(dest).size > 1_000_000) {
    console.log('Using cached', dest);
    return;
  }
  console.log('Downloading', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log('Saved', dest);
}

function unzip(zipPath, dest) {
  mkdirSync(dest, { recursive: true });
  execSync(`python3 <<'PY'
import zipfile
zipfile.ZipFile(${JSON.stringify(zipPath)}).extractall(${JSON.stringify(dest)})
PY`);
}

function zipDir(srcDir, outZip, prefixName) {
  execSync(`python3 - <<'PY'
import zipfile, os
from pathlib import Path
src = Path(${JSON.stringify(srcDir)})
out = Path(${JSON.stringify(outZip)})
prefix = ${JSON.stringify(prefixName)}
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for p in src.rglob('*'):
        if p.is_file():
            z.write(p, Path(prefix) / p.relative_to(src))
print(out, out.stat().st_size)
PY`);
}

// 1) Ensure built
console.log('Building TypeScript…');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

// 2) Stage clean folder
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// 3) Download & extract Node win-x64
await download(nodeUrl, nodeZipPath);
const nodeExtract = join(cacheDir, `node-extract-${nodeVer}`);
rmSync(nodeExtract, { recursive: true, force: true });
unzip(nodeZipPath, nodeExtract);
const nodeInner = join(nodeExtract, `node-v${nodeVer}-win-x64`);
if (!existsSync(join(nodeInner, 'node.exe'))) throw new Error('node.exe missing after extract');
cpSync(nodeInner, join(stage, 'runtime'), { recursive: true });

// 4) App files (production deps)
const appDir = join(stage, 'app');
mkdirSync(appDir, { recursive: true });
for (const name of ['dist', 'ui', 'bin', 'package.json', 'package-lock.json', 'README.md', 'README.zh-CN.md', 'BUILD.md', 'START.bat']) {
  const src = join(root, name);
  if (existsSync(src)) {
    cpSync(src, join(appDir, name), { recursive: true });
  }
}
// production node_modules inside app
console.log('Installing production deps into stage…');
execSync('npm install --omit=dev', { cwd: appDir, stdio: 'inherit' });

// 5) Launcher + install scripts
writeFileSync(
  join(stage, 'VaultAI.bat'),
  `@echo off
setlocal
cd /d "%~dp0"
set "PATH=%~dp0runtime;%~dp0runtime\\node_modules\\npm\\bin;%PATH%"
cd /d "%~dp0app"
"%~dp0runtime\\node.exe" dist\\server\\index.js
pause
`
);

writeFileSync(
  join(stage, 'VaultAI-Silent.bat'),
  `@echo off
cd /d "%~dp0app"
start "" "%~dp0runtime\\node.exe" dist\\server\\index.js
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:3847/
`
);

const installPs1 = readFileSync(join(root, 'scripts', 'Install-VaultAI.ps1.template'), 'utf8').replaceAll('__VERSION__', version);
writeFileSync(join(stage, 'Install-VaultAI.ps1'), installPs1);

writeFileSync(
  join(stage, 'Uninstall-VaultAI.ps1'),
  `# Placeholder — Install-VaultAI.ps1 overwrites this in install dir
Write-Host "Run Install-VaultAI.ps1 first, then use the copy under %LOCALAPPDATA%\\VaultAI"
`
);

writeFileSync(
  join(stage, 'VaultAI-Setup.bat'),
  `@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   VaultAI Tools ${version}  安装版 / Setup
echo   给 AI 用的密码管家 · Password manager for AI
echo ============================================
echo.
echo [中文] 将安装到 %%LOCALAPPDATA%%\VaultAI
echo        创建开始菜单、桌面快捷方式，并注册「应用和功能」卸载项。
echo [EN]   Installs to %%LOCALAPPDATA%%\VaultAI
echo        Creates Start Menu + Desktop shortcuts and Apps & features entry.
echo.
echo 安装后将自动启动 / Will launch after install.
echo.
pause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-VaultAI.ps1"
if errorlevel 1 (
  echo 安装失败 / Install failed.
  pause
  exit /b 1
)
echo.
echo 完成 / Done. See 安装说明.txt
pause
`
);

writeFileSync(
  join(stage, 'README-安装说明.txt'),
  `VaultAI Tools ${version} — Windows 安装版（增强）
========================================

【推荐】双击 VaultAI-Setup.bat
  → 安装到 %LOCALAPPDATA%\VaultAI
  → 开始菜单「VaultAI Tools」+ 桌面快捷方式
  → 注册到 Windows「应用和功能」可卸载
  → 自动打开应用

【便携】不解压安装也可：双击 VaultAI-Silent.bat

【卸载】
  设置 → 应用 → VaultAI Tools → 卸载
  或 开始菜单 → VaultAI → 卸载 VaultAI
  或 %LOCALAPPDATA%\VaultAI\Uninstall-VaultAI.ps1

语言：应用内 设置 → 界面语言（中文 / English）
MCP: http://127.0.0.1:3847/mcp
`
);

// 6) Zip
const outZip = join(releaseDir, `VaultAI-Setup-${version}-win-x64.zip`);
console.log('Zipping installer…');
zipDir(stage, outZip, `VaultAI-Setup-${version}`);
const size = (await import('node:fs')).statSync(outZip).size;
console.log('Installer package:', outZip, `(${(size / 1024 / 1024).toFixed(1)} MiB)`);

// Also copy a clear alias name
const alias = join(releaseDir, 'VaultAI-Setup.zip');
cpSync(outZip, alias);
console.log('Alias:', alias);

rmSync(stage, { recursive: true, force: true });
