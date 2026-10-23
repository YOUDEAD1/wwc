@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 20 or newer, then open this file again.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<20)process.exit(1)"
if errorlevel 1 (
  echo This project requires Node.js 20 or newer.
  pause
  exit /b 1
)
if not exist .env (
  copy .env.example .env >nul
  echo Fill the .env file, apply migration 0044 to Supabase, then open this file again.
  start "" notepad .env
  pause
  exit /b 0
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 goto failed
)
call npm run build
if errorlevel 1 goto failed
echo Apply supabase/migrations/0044_secure_checkout_and_runtime.sql before starting this update.
call npm start
if errorlevel 1 goto failed
exit /b 0
:failed
echo Startup failed. Read the error above and docs/UPDATE-2026-10-22.md.
pause
exit /b 1
