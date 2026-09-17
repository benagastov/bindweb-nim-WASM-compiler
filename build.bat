@echo off
setlocal
cd /d "%~dp0"

set "BASH_EXE=%ProgramFiles%\Git\bin\bash.exe"
if exist "%BASH_EXE%" goto run_build

set "BASH_EXE=%ProgramFiles(x86)%\Git\bin\bash.exe"
if exist "%BASH_EXE%" goto run_build

echo Error: Git for Windows Bash was not found. 1>&2
echo Install Git for Windows, then run this file again. 1>&2
exit /b 1

:run_build
"%BASH_EXE%" toolchain/windows-build.sh %*
exit /b %errorlevel%
