@echo off
rem Build the NSIS bundle through the Tauri CLI 2.x.
rem CLI resolution order (no machine-specific path is hard-coded):
rem   1) env TAURI_CLI  -> path to @tauri-apps/cli/tauri.js
rem   2) <repo>\node_modules\@tauri-apps\cli\tauri.js
rem   3) cargo tauri   -> requires: cargo install tauri-cli --version ^<2
setlocal
cd /d "%~dp0.."
set "CLI_JS="
if defined TAURI_CLI if exist "%TAURI_CLI%" set "CLI_JS=%TAURI_CLI%"
if not defined CLI_JS if exist "%~dp0..\node_modules\@tauri-apps\cli\tauri.js" set "CLI_JS=%~dp0..\node_modules\@tauri-apps\cli\tauri.js"
set "VCVARS="
for %%P in (
  "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
  "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
  "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
  "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
) do if not defined VCVARS if exist %%P set "VCVARS=%%~P"
if not defined VCVARS (
  echo [error] vcvars64.bat not found ^(install Visual Studio Build Tools with the C++ workload^)
  exit /b 1
)
call "%VCVARS%" >nul
if defined CLI_JS (
  echo [info] tauri cli: %CLI_JS%
  node "%CLI_JS%" build %*
  exit /b %ERRORLEVEL%
)
echo [info] tauri cli: cargo tauri
cargo tauri build %*
if errorlevel 1 (
  echo [hint] if "cargo tauri" is missing: cargo install tauri-cli --version ^<2
  echo [hint] or set TAURI_CLI=^<path to @tauri-apps/cli/tauri.js^>
  exit /b 1
)
exit /b 0
