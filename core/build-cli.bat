@echo off
rem Build the C++ rule kernel plus yyb-cli.exe with MSVC (no cargo needed).
rem Output: core\build\yyb-cli.exe   Usage: core\build-cli.bat
setlocal
cd /d "%~dp0"
where cl >nul 2>&1
if not errorlevel 1 goto build
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" goto fallback
for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do call "%%i\VC\Auxiliary\Build\vcvars64.bat" >nul
where cl >nul 2>&1
if not errorlevel 1 goto build
:fallback
call "%ProgramFiles%\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat" >nul
where cl >nul 2>&1
if errorlevel 1 goto nocompiler
:build
if not exist build mkdir build
rem 源清单唯一真源：sources.txt（与 src-tauri\build.rs 共用）
set "SRC="
for /f "usebackq eol=# delims=" %%f in ("sources.txt") do call set "SRC=%%SRC%% %%f"
cl /nologo /std:c++17 /utf-8 /EHsc /O2 /W3 /I"include" /I"src" %SRC% cli\main.cpp /Fo:build\ /Fd:build\yyb-cli.pdb /Fe:build\yyb-cli.exe
if errorlevel 1 exit /b 1
echo built core\build\yyb-cli.exe
exit /b 0
:nocompiler
echo [yyb] MSVC compiler not found. Install Visual Studio Build Tools with the C++ workload.
exit /b 1
