@echo off
rem One-shot acceptance gate for 0.1.0:
rem   1) JS <-> C++ parity (golden corpus, per-key deep-equal)
rem   2) build the app
rem   3) smoke-test the compiled core binding through yyb-check.exe
setlocal
cd /d "%~dp0.."

echo [1/4] rule meta + corpus
node tools\parity\rulemeta.mjs
if errorlevel 1 exit /b 1
node tools\parity\gen-corpus.mjs
if errorlevel 1 exit /b 1

echo [2/4] parity gate
call core\build-cli.bat
if errorlevel 1 exit /b 1
node tools\parity\gen-golden.mjs
if errorlevel 1 exit /b 1
node tools\parity\run-parity.mjs
if errorlevel 1 exit /b 1

echo [3/4] build the Tauri app
call scripts\build-windows.bat
if errorlevel 1 exit /b 1

echo [4/4] smoke test the FFI binding
set "EXE=src-tauri\target\release\yyb-check.exe"
"%EXE%" --version
if errorlevel 1 exit /b 1
"%EXE%" weekly "tools\parity\fixtures\smoke-weekly.txt"
if errorlevel 1 exit /b 1
rem v1.7: the 5th template (agentcmd) must also answer end-to-end through Rust -> C ABI -> C++
"%EXE%" agentcmd "tools\parity\fixtures\agentcmd-ok.txt"
if errorlevel 1 exit /b 1
"%EXE%" agentcmd "tools\parity\fixtures\agentcmd-missing-boundary.txt"
if errorlevel 1 exit /b 1
echo.
echo ALL CHECKS PASSED
exit /b 0
