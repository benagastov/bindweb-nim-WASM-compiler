# =============================================================================
# nim.wasm + nim-bundle.js — reproducible from-source build (Nim -> Emscripten).
#
# Build context is the REPO ROOT:
#   docker build -t nimwasm/nim -f toolchain/nim/Dockerfile .
#   docker run --rm \
#     -v "$PWD/web/vendor/nim:/out" \
#     -v "$PWD/libpacks:/build/libpacks" \
#     nimwasm/nim
#
# (./build.sh nim-docker runs exactly this for you.)
#
# Pins Nim + emsdk via versions.env. emsdk's first run downloads its toolchain
# from the network, so build with connectivity (or prime the emsdk cache).
#
# Outputs:
#   /out               -> nim.wasm, nim-bundle.js, nimbase.h   (bind-mount web/vendor/nim)
#   /build/libpacks    -> nim-stdlib.tar, nim-config.tar       (bind-mount libpacks/)
# =============================================================================
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git xz-utils \
        build-essential python3 \
        nodejs \
    && rm -rf /var/lib/apt/lists/*

# Pinned emsdk (Emscripten). EMSDK_VERSION comes from versions.env (passed as
# a build arg by ./build.sh nim-docker); install + activate it.
ARG EMSDK_VERSION=3.1.69
RUN git clone https://github.com/emscripten-core/emsdk /opt/emsdk \
    && cd /opt/emsdk \
    && ./emsdk install "${EMSDK_VERSION}" \
    && ./emsdk activate "${EMSDK_VERSION}"
ENV EMSDK_DIR=/opt/emsdk

WORKDIR /build
# The build script resolves the repo root as two levels up from
# toolchain/nim/, so keep the repo layout: /build/{versions.env,toolchain/nim,tools,libpacks}.
COPY versions.env /build/versions.env
COPY toolchain/nim/build.sh /build/toolchain/nim/build.sh
# tools/ provides pack-lib.sh (libpacks branch) for the stdlib/config packs.
COPY tools/ /build/tools/
RUN mkdir -p /build/libpacks

VOLUME /out
ENV OUT=/out
CMD ["bash", "/build/toolchain/nim/build.sh"]
