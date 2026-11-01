@echo off
rem Build YanYiBian 0.1.0 for Windows x64 with MSVC + cargo.
rem Output: src-tauri\target\release\yanyibian.exe  and  yyb-check.exe
setlocal
cd /d "%~dp0.."

where cl >nul 2>&1
if not errorlevel 1 goto build

set "VCV=%ProgramFiles%\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VCV%" call "%VCV%" >nul 2>&1
where cl >nul 2>&1
if not errorlevel 1 goto build

set "VCV=%ProgramFiles%\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VCV%" call "%VCV%" >nul 2>&1
where cl >nul 2>&1
if not errorlevel 1 goto build

set "VCV=%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VCV%" call "%VCV%" >nul 2>&1
where cl >nul 2>&1
if not errorlevel 1 goto build

set "VCV=%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if exist "%VCV%" call "%VCV%" >nul 2>&1
where cl >nul 2>&1
if not errorlevel 1 goto build

echo [yyb] MSVC compiler not found. Install Visual Studio Build Tools with the C++ workload.
exit /b 1

:build
pushd src-tauri
cargo build --release
set RC=%ERRORLEVEL%
popd
if not "%RC%"=="0" exit /b 1
echo.
echo built  src-tauri\target\release\yanyibian.exe
echo built  src-tauri\target\release\yyb-check.exe
exit /b 0
