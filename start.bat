@echo off
REM =============================================================================
REM start.bat - the ONE double-click file for Windows beginners.
REM
REM WHAT: Goes from a fresh download of this project to a running in-browser
REM       Nim compiler at http://localhost:8080, in four steps:
REM
REM         [1/4] Download the C compiler (prebuilt - no hours-long build)
REM         [2/4] Build the Nim compiler (skipped entirely if already built)
REM         [3/4] Pack the libraries and assemble the app (dist\)
REM         [4/4] Start a local server and open your web browser
REM
REM WHY:  Everything runs inside Docker, so the ONLY requirement on Windows
REM       is Docker Desktop. Every step that is already done is detected and
REM       skipped, so you can double-click this file as often as you like -
REM       after a failure it simply picks up where it stopped.
REM
REM HOW:  Double-click start.bat (or run it from a Command Prompt).
REM       Power users can use WSL and ./build.sh for finer control.
REM =============================================================================
setlocal
cd /d "%~dp0"

echo ============================================================
echo   nim-wasm-compiler - one-click start (Windows)
echo   Sit back: anything already done is skipped automatically.
echo   When everything is ready your web browser will open at
echo   http://localhost:8080
echo ============================================================
echo.

REM ---- prerequisite: Docker Desktop must be installed AND running -------------
where docker >nul 2>nul
if errorlevel 1 goto no_docker
docker info >nul 2>nul
if errorlevel 1 goto docker_not_running

REM ---- [1/4] the prebuilt C compiler (never an LLVM build) --------------------
echo [1/4] Getting the C compiler (prebuilt, no long build)...
if exist web\vendor\clang\clang.js if exist web\vendor\clang\clang.wasm if exist web\vendor\clang\lld.wasm if exist web\vendor\clang\memfs.wasm if exist web\vendor\clang\sysroot.tar goto clang_ready
REM fetch-clang.sh is bash; run it in a throwaway container with curl present.
docker run --rm -v "%cd%:/repo" -w /repo ubuntu:22.04 bash -c "apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null && bash toolchain/fetch-clang.sh"
if errorlevel 1 goto fail_download
echo       Done.
goto clang_done
:clang_ready
echo       Already downloaded earlier - skipping.
:clang_done

REM ---- [2/4] nim.wasm - the only thing ever compiled --------------------------
echo [2/4] Building the Nim compiler (first time only; 20-40 minutes)...
if exist web\vendor\nim\nim.wasm goto nim_ready
docker build -t nimwasm/nim -f toolchain/nim/Dockerfile .
if errorlevel 1 goto fail_nim
if not exist web\vendor\nim mkdir web\vendor\nim
if not exist libpacks mkdir libpacks
REM Artifacts land in web\vendor\nim and libpacks\ via bind mounts; tools\ is
REM mounted read-only over the image copy so the container runs the current
REM pack-lib.sh.
docker run --rm -v "%cd%\web\vendor\nim:/out" -v "%cd%\libpacks:/build/libpacks" -v "%cd%\tools:/build/tools:ro" nimwasm/nim
if errorlevel 1 goto fail_nim
if not exist web\vendor\nim\nim.wasm goto fail_nim
echo       Done.
goto nim_done
:nim_ready
echo       Already built earlier - skipping.
:nim_done

REM ---- [3/4] library packs + assemble dist\ ------------------------------------
echo [3/4] Packing libraries and putting the app together...
if exist libpacks\manifest.json goto libs_ready
if not exist tools\pack-lib.sh goto libs_warn
if not exist libpacks\src goto libs_warn
docker run --rm -v "%cd%:/repo" -w /repo ubuntu:22.04 bash build.sh libs
if errorlevel 1 goto fail_libs
goto make_dist
:libs_warn
echo       WARNING: library packs are missing; the app will open without them.
goto make_dist
:libs_ready
echo       Library packs are ready - skipping.
:make_dist
docker run --rm -v "%cd%:/repo" -w /repo ubuntu:22.04 bash build.sh dist
if errorlevel 1 goto fail_dist
echo       Done.

REM ---- [4/4] serve dist\ and open the browser ----------------------------------
echo [4/4] Starting your local server and opening the app...
echo.
echo ============================================================
echo   All done! The app lives at:
echo       http://localhost:8080
echo   Your browser should open in a moment. Keep THIS window open
echo   while you use the app; close it to stop the server.
echo ============================================================
echo.
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:8080"
where python >nul 2>nul
if not errorlevel 1 goto serve_python
where py >nul 2>nul
if not errorlevel 1 goto serve_py
goto serve_docker

:serve_python
cd dist
python -m http.server 8080
goto serve_done

:serve_py
cd dist
py -m http.server 8080
goto serve_done

:serve_docker
echo (Python not found; serving via Docker instead.)
docker run --rm -p 8080:8080 -v "%cd%\dist:/dist" -w /dist python:3-slim python -m http.server 8080

:serve_done
echo.
echo The server has stopped. You can close this window.
pause
exit /b 0

REM ---- friendly failure exits (pause keeps the window open for double-clickers)
:no_docker
echo.
echo *** Docker Desktop is not installed (or not on PATH).
echo       1. Install it:  https://www.docker.com/products/docker-desktop/
echo       2. Open Docker Desktop once so it finishes setting up.
echo       3. Double-click start.bat again.
pause
exit /b 1

:docker_not_running
echo.
echo *** Docker Desktop is installed but not running.
echo     Open Docker Desktop, wait until it says it is running,
echo     then double-click start.bat again.
pause
exit /b 1

:fail_download
echo.
echo *** The compiler download did not finish.
echo     Check your internet connection, then double-click start.bat
echo     again - it will resume where it stopped.
pause
exit /b 1

:fail_nim
echo.
echo *** The Nim compiler build did not finish inside Docker.
echo     The most common cause is Docker running low on memory: open
echo     Docker Desktop, go to Settings ^> Resources, give it at least
echo     4 GB of memory, then double-click start.bat again.
pause
exit /b 1

:fail_libs
echo.
echo *** Packing the libraries failed.
echo     Double-click start.bat again; if it keeps failing, ask someone
echo     technical to run:  bash build.sh libs
pause
exit /b 1

:fail_dist
echo.
echo *** Putting the app together (dist\) failed.
echo     Make sure this folder contains the complete project (including
echo     the web\ folder), then double-click start.bat again.
pause
exit /b 1
