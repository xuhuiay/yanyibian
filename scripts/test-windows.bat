@echo off
setlocal
set "VCVARS="
for %%P in (
  "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat",
  "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat",
  "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
) do if not defined VCVARS if exist %%P set "VCVARS=%%~P"
if not defined VCVARS (echo [test] vcvars64.bat not found & exit /b 1)
call "%VCVARS%" >nul || exit /b 1
cd /d "%~dp0..\src-tauri" || exit /b 1
cargo test --release --lib %*
exit /b %ERRORLEVEL%
