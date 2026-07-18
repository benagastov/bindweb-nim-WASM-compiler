@echo off
REM =============================================================================
REM build.bat - Windows wrapper for the nim-wasm-compiler build.
REM
REM WHAT: Builds the project on Windows. The nim.wasm cross-compile requires a
REM       POSIX shell + Emscripten, so on Windows the supported path is Docker
REM       (which runs toolchain/nim/Dockerfile in a Linux container). Fetching
REM       the prebuilt clang toolchain and packing libpacks also need bash, so
REM       without Docker you must use WSL (Windows Subsystem for Linux).
REM
REM HOW:  build.bat            - full build (docker) + dist
REM       build.bat nim        - build nim.wasm via Docker only
REM       build.bat serve      - serve dist\ on http://localhost:8080
REM
REM Requires: Docker Desktop, or WSL with bash (then run ./build.sh instead).
REM =============================================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "TARGET=%~1"
if "%TARGET%"=="" set "TARGET=all"

where docker >nul 2>nul
if errorlevel 1 goto no_docker

if /i "%TARGET%"=="nim" goto nim
if /i "%TARGET%"=="nim-docker" goto nim
if /i "%TARGET%"=="serve" goto serve
if /i "%TARGET%"=="all" goto all
echo unknown target: %TARGET% 1>&2
echo usage: build.bat [all^|nim^|serve] 1>&2
exit /b 2

:all
echo ==^> clang: fetching prebuilt wasm-clang toolchain (inside a container)
REM fetch-clang.sh is bash and needs curl; run it in a throwaway container
REM with the repo mounted, installing curl first (ubuntu:22.04 lacks it).
docker run --rm -v "%cd%:/repo" -w /repo ubuntu:22.04 bash -c "apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null && bash toolchain/fetch-clang.sh"
if errorlevel 1 exit /b 1
call :nim
if errorlevel 1 exit /b 1
echo ==^> libs/dist: packing libpacks and assembling dist (inside a container)
docker run --rm -v "%cd%:/repo" -w /repo ubuntu:22.04 bash -c "bash build.sh libs && bash build.sh dist"
if errorlevel 1 exit /b 1
echo ==^> done - run: build.bat serve
exit /b 0

:nim
echo ==^> nim: building nim.wasm via Docker (this takes a while the first time)
docker build -t nimwasm/nim -f toolchain/nim/Dockerfile .
if errorlevel 1 exit /b 1
if not exist web\vendor\nim mkdir web\vendor\nim
if not exist libpacks mkdir libpacks
REM Artifacts land in web\vendor\nim and libpacks\ via bind mounts; tools\ is
REM mounted read-only over the image copy so the container runs the current
REM pack-lib.sh.
docker run --rm -v "%cd%\web\vendor\nim:/out" -v "%cd%\libpacks:/build/libpacks" -v "%cd%\tools:/build/tools:ro" nimwasm/nim
exit /b %errorlevel%

:serve
echo ==^> serve: http://localhost:8080 from dist\
where python >nul 2>nul
if errorlevel 1 (
  echo python not found; install Python 3 or run: npx serve dist
  exit /b 1
)
cd dist
python -m http.server 8080
exit /b %errorlevel%

:no_docker
echo error: docker not found on PATH. 1>&2
echo. 1>&2
echo On Windows this project builds either: 1>&2
echo   1. with Docker Desktop - install it, then re-run build.bat 1>&2
echo   2. inside WSL - open a WSL shell and use ./build.sh instead 1>&2
exit /b 1
