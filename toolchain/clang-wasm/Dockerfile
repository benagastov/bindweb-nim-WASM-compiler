# =============================================================================
# clang.wasm + lld.wasm + sysroot.tar — reproducible from-source LLVM build.
#
#   docker build -t nimwasm/clang toolchain/clang-wasm
#   docker run --rm -v "$PWD/out:/out" nimwasm/clang
#
# Heavy: give Docker plenty of disk and >=16 GB RAM. On GitHub-hosted runners
# use the workflow in .github/workflows/build-toolchain.yml.
# =============================================================================
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive

ARG WASI_SDK_VERSION=12.0

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git xz-utils \
        cmake ninja-build python3 \
        clang lld llvm \
        nodejs \
    && rm -rf /var/lib/apt/lists/*

# wasi-sdk = cross toolchain (wasm clang + wasi-libc sysroot). Pinned by arg.
# If release assets are blocked on your network, build wasi-sdk from source or
# COPY a vendored tarball here instead of curl.
RUN mkdir -p /opt/wasi-sdk \
    && MAJOR="${WASI_SDK_VERSION%%.*}" \
    && curl -sSL \
       "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${MAJOR}/wasi-sdk-${WASI_SDK_VERSION}-linux.tar.gz" \
       | tar xz --strip-components=1 -C /opt/wasi-sdk
ENV WASI_SDK=/opt/wasi-sdk

WORKDIR /build
COPY clang-wasm/ /build/clang-wasm/
COPY versions.env /build/versions.env

VOLUME /out
ENV OUT=/out
CMD ["bash", "/build/clang-wasm/build.sh"]
