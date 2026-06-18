# =============================================================================
# memfs.wasm — reproducible from-source build.
#   docker build -t nimwasm/memfs toolchain/memfs
#   docker run --rm -v "$PWD/out:/out" nimwasm/memfs   # -> out/memfs.wasm
# =============================================================================
FROM ubuntu:22.04

ARG WASI_SDK_VERSION=12.0
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl xz-utils make nodejs \
    && rm -rf /var/lib/apt/lists/*

# wasi-sdk supplies the wasm clang + wasi-libc sysroot. Pinned via build-arg.
# NOTE: release tarballs are hosted on github releases. If your network blocks
# release assets, build wasi-sdk from source (see toolchain/clang-wasm) or
# vendor the tarball and COPY it in instead of curl.
RUN mkdir -p /opt/wasi-sdk \
    && MAJOR="${WASI_SDK_VERSION%%.*}" \
    && curl -sSL \
       "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${MAJOR}/wasi-sdk-${WASI_SDK_VERSION}-linux.tar.gz" \
       | tar xz --strip-components=1 -C /opt/wasi-sdk
ENV WASI_SDK=/opt/wasi-sdk

WORKDIR /src
COPY memfs/ /src/memfs/
COPY versions.env /src/versions.env

VOLUME /out
CMD ["bash", "/src/memfs/build.sh", "/out"]
