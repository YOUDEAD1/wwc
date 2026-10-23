@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 LTS first.
  pause
  exit /b 1
)
if not exist .env (
  copy .env.platform.example .env >nul
  echo Fill .env, run the SQL setup, and read docs\PLATFORM-AR.md.
  notepad .env
  pause
  exit /b 0
)
call npm ci
if errorlevel 1 goto failed
call npm run build
if errorlevel 1 goto failed
call npm run start:platform
if errorlevel 1 goto failed
pause
exit /b 0
:failed
echo Startup failed. Review the error above and docs\PLATFORM-AR.md.
pause
exit /b 1
