@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 20+ required & pause & exit /b 1)
if not exist node_modules call npm install
if not exist dist\server\index.js call npm run build
echo.
echo VaultAI Tools — open http://127.0.0.1:3847
echo.
npm start
pause
