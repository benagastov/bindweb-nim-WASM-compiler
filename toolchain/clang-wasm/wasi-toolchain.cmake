# =============================================================================
# wasi-toolchain.cmake — make CMake cross-compile to wasm32-wasi using wasi-sdk.
# Passed to the stage-2 LLVM build via -DCMAKE_TOOLCHAIN_FILE.
# Expects -DWASI_SDK=/opt/wasi-sdk (an extracted wasi-sdk).
# =============================================================================
if(NOT WASI_SDK)
  set(WASI_SDK "/opt/wasi-sdk")
endif()

# Tell cmake the cross-compiler "works" without doing a try_compile probe —
# the produced wasm32-wasi binary can't be executed on the build host, so the
# probe would always fail.  Setting these flags in the toolchain file (rather
# than a separate Platform/WASI.cmake) avoids needing to install files into
# /usr/share/cmake-3.25/Modules/Platform/.
set(CMAKE_C_COMPILER_WORKS 1 CACHE INTERNAL "")
set(CMAKE_CXX_COMPILER_WORKS 1 CACHE INTERNAL "")
set(CMAKE_C_COMPILER_ABI_COMPILED 1)
set(CMAKE_CXX_COMPILER_ABI_COMPILED 1)
set(CMAKE_C_ABI_COMPILED 1)
set(CMAKE_CXX_ABI_COMPILED 1)
set(CMAKE_C_PLATFORM_ID "WASI")
set(CMAKE_CXX_PLATFORM_ID "WASI")

set(CMAKE_SYSTEM_NAME WASI)
set(CMAKE_SYSTEM_VERSION 1)
set(CMAKE_SYSTEM_PROCESSOR wasm32)
# WASI is unix-like: pthread, mmap, signals, etc.  LLVM's HandleLLVMOptions
# gate-keeps its entire options block on (FUCHSIA OR UNIX); without UNIX TRUE
# the configure aborts with "Unable to determine platform".
set(UNIX 1)
set(LLVM_ON_UNIX 1)
set(LLVM_ON_WIN32 0)
set(LLVM_HAVE_LINK_VERSION_SCRIPT 1)

set(WASI_SYSROOT "${WASI_SDK}/share/wasi-sysroot")
set(CMAKE_SYSROOT "${WASI_SYSROOT}")

set(CMAKE_C_COMPILER   "${WASI_SDK}/bin/clang")
set(CMAKE_CXX_COMPILER "${WASI_SDK}/bin/clang++")
set(CMAKE_AR           "${WASI_SDK}/bin/llvm-ar"     CACHE FILEPATH "" FORCE)
set(CMAKE_RANLIB       "${WASI_SDK}/bin/llvm-ranlib" CACHE FILEPATH "" FORCE)

set(triple wasm32-wasi)
set(CMAKE_C_COMPILER_TARGET   ${triple})
set(CMAKE_CXX_COMPILER_TARGET ${triple})

# wasm has no exceptions/RTTI/threads in this build; LLVM is fine without them.
# BINJI_HACK stubs out getpid() in CodeGenCoverage.cpp — wasi-libc has no getpid
# (no real processes in WASI), but the binji LLVM 8 fork already provides a
# #ifndef BINJI_HACK branch around the call returning a constant 31415.
#
# _LIBCPP_HAS_EXTERNAL_ATOMIC_IMP forces wasi-libc++ to provide the atomic
# header (std::atomic_flag etc.) even when LLVM_ENABLE_THREADS=OFF defined
# _LIBCPP_HAS_NO_THREADS — LLVM 8's Support/Threading.cpp still uses atomic_flag
# for its internal mutexes and won't compile without it.
set(_wasm_flags "-fno-exceptions -fno-rtti -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_MMAN -DBINJI_HACK -D_LIBCPP_HAS_EXTERNAL_ATOMIC_IMP -DHAVE_UNISTD_H")
set(CMAKE_C_FLAGS_INIT   "${_wasm_flags}")
set(CMAKE_CXX_FLAGS_INIT "${_wasm_flags}")
# Also add via add_compile_options so it survives a cached reconfigure.
add_compile_options(-DHAVE_UNISTD_H -DBINJI_HACK -D_LIBCPP_HAS_EXTERNAL_ATOMIC_IMP)
set(CMAKE_EXE_LINKER_FLAGS_INIT
    "-lwasi-emulated-signal -lwasi-emulated-process-clocks -lwasi-emulated-mman")

# Look for libs/headers only in the wasi sysroot, but allow host programs
# (tablegen) to be found via the variables we pass explicitly.
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
