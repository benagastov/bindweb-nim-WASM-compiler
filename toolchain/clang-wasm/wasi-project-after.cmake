# =============================================================================
# wasi-project-after.cmake — runs AFTER the top-level project() call but
# BEFORE the add_subdirectory() of any subprojects.  CMAKE_PROJECT_LLVM_INCLUDE
# is evaluated in scope of the "LLVM" project, so this is the right hook.
#
# project() resets UNIX/WIN32/APPLE/FUCHSIA based on CMAKE_SYSTEM_NAME; for
# WASI none of the regular branches match, so UNIX becomes empty and the very
# first thing HandleLLVMOptions.cmake does is fatal-error "Unable to determine
# platform".  We re-assert UNIX=1 right after project() so the check sees a
# Unix-like platform.
# =============================================================================
message(STATUS "[wasi-project-after] RUNNING (post-project) hook")
message(STATUS "[wasi-project-after]   before: UNIX=${UNIX} WIN32=${WIN32} FUCHSIA=${FUCHSIA}")
set(UNIX 1)
set(LLVM_ON_UNIX 1)
set(LLVM_ON_WIN32 0)
set(LLVM_HAVE_LINK_VERSION_SCRIPT 1)
message(STATUS "[wasi-project-after]   after:  UNIX=${UNIX}")
