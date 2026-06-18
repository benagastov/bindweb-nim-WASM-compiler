# Minimal Platform/WASI.cmake shim for cmake 3.25.
#
# cmake 3.25 added the WASI platform name.  LLVM 8.0.1 (2019-era) is too
# old to ship its own.  We provide just enough to convince cmake to
# accept the cross-compiler without running a try_compile probe (which
# would fail anyway because the produced .wasm cannot be executed on
# the build host).
#
# The actual compiler / sysroot / flags are configured by
# wasi-toolchain.cmake (passed via -DCMAKE_TOOLCHAIN_FILE).  This shim
# only exists to make the platform name "WASI" known.

set(CMAKE_C_COMPILER_WORKS 1 CACHE INTERNAL "")
set(CMAKE_CXX_COMPILER_WORKS 1 CACHE INTERNAL "")
set(CMAKE_C_COMPILER_ABI_COMPILED 1)
set(CMAKE_CXX_COMPILER_ABI_COMPILED 1)
set(CMAKE_C_ABI_COMPILED 1)
set(CMAKE_CXX_ABI_COMPILED 1)
set(CMAKE_C_PLATFORM_ID "WASI")
set(CMAKE_CXX_PLATFORM_ID "WASI")
