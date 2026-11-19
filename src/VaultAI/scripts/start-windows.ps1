# VaultAI Tools — Windows launcher
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..
if (-not (Test-Path node_modules)) { npm install }
if (-not (Test-Path dist\server\index.js)) { npm run build }
Write-Host "Starting VaultAI on http://127.0.0.1:3847 ..."
npm start
