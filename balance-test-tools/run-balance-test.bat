@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Chanceboard Balance Test

echo ============================================
echo   Chanceboard - Balance Test
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo Please install it from https://nodejs.org first ^(LTS version^),
  echo then double-click this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run detected. Installing required packages, please wait ^(may take a minute or two^)...
  echo.
  call npm install playwright
  if errorlevel 1 (
    echo [ERROR] Failed to install the playwright package. Check your internet connection and try again.
    pause
    exit /b 1
  )
  echo.
  echo Packages installed successfully!
  echo.
)

rem Always verify the browser component itself, even if node_modules already exists.
rem (node_modules can be present while the actual browser binary - stored outside
rem this folder, in the system's playwright cache - is missing or was never
rem downloaded, e.g. because a previous run's download failed or was interrupted.
rem This check is fast/no-op when the browser is already installed.)
echo Checking browser component...
call npx playwright install chromium
if errorlevel 1 (
  echo [ERROR] Failed to download the browser component. Check your internet connection and try again.
  pause
  exit /b 1
)
echo.

set N=
set /p N=How many games to run? (press Enter for default 360):
if "%N%"=="" set N=360

set CONC=
set /p CONC=How many parallel browser tabs? (press Enter for default 4, match your CPU core count):
if "%CONC%"=="" set CONC=4

echo.
echo Running %N% games with %CONC% parallel tabs, please wait...
echo (Text will keep scrolling during this step - that's normal. It will continue automatically when done.)
echo.
node run_balance_trials.js %N% %CONC%
if errorlevel 1 (
  echo.
  echo [ERROR] Something went wrong while running the batch. See the error message above.
  pause
  exit /b 1
)

echo.
echo Analyzing results...
echo.
node analyze_balance.js balance_results.jsonl

echo.
echo Opening the report in your browser...
start "" "balance_report.html"

echo.
echo ============================================
echo   All done! The report has been opened in your browser.
echo   You can close this window now, or press any key.
echo ============================================
pause >nul
