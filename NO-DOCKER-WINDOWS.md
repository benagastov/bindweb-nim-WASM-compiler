# Docker-free Windows workflow

This checkout has a Windows launcher that does **not** use or require Docker.

It first tries the repository's SHA-256-pinned prebuilt `nim.wasm` and Clang WebAssembly artifacts. Git for Windows supplies Bash for the existing build scripts, and the installed Python serves the generated static site.

The upstream prebuilt Nim mirror currently returns HTTP 404. When that happens, the launcher automatically uses the local Nim 2.0.14 compiler and a project-local, pinned Emscripten 3.1.69 SDK to create `nim.wasm` natively. This first build downloads several hundred megabytes, but subsequent builds reuse it. Docker is never involved.

## Start the IDE

Double-click `start.bat`, or run:

```powershell
.\start.bat
```

The launcher builds the site, opens `http://localhost:8080`, and keeps the local server in the current window. Press `Ctrl+C` to stop it.

Options can be passed through to the PowerShell launcher:

```powershell
# Build dist/ without starting a server
.\start.bat -BuildOnly

# Serve on another port without opening a browser
.\start.bat -Port 9000 -NoBrowser
```

## Individual build targets

`build.bat` forwards targets to the existing `build.sh` through Git Bash:

```powershell
.\build.bat clang
.\build.bat nim-fetch
.\build.bat libs
.\build.bat dist
```

The default `build.bat all` path tries the verified prebuilt compilers and falls back to the project-local native Emscripten toolchain. The Windows wrapper explicitly rejects the `nim-docker` target.
