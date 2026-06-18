# =============================================================================
# wasi-project-before.cmake — runs AFTER the toolchain file but BEFORE the
# top-level project() call (CMake 3.18+ CMAKE_PROJECT_INCLUDE_BEFORE).
#
# Needed because LLVM's HandleLLVMOptions.cmake gate-keeps its entire options
# block on (WIN32) or (FUCHSIA OR UNIX), and project() resets UNIX based on
# CMAKE_SYSTEM_NAME (which we just set to WASI in the toolchain file).
# Re-asserting it here, post-toolchain but pre-project(), is the only point
# the check can be made sticky.
# =============================================================================
message(STATUS "[wasi-project-before] RUNNING hook")
set(UNIX 1)
set(LLVM_ON_UNIX 1)
set(LLVM_ON_WIN32 0)
set(LLVM_HAVE_LINK_VERSION_SCRIPT 1)
message(STATUS "[wasi-project-before] UNIX=${UNIX} WIN32=${WIN32} FUCHSIA=${FUCHSIA}")

