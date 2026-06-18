# =============================================================================
# nim.wasm + nim-bundle.js — reproducible from-source build (Nim -> Emscripten).
#
#   docker build -t nimwasm/nim toolchain/nim-wasm
#   docker run --rm -v "$PWD/out:/out" nimwasm/nim
#
# Pins Nim + emsdk via versions.env. emsdk's first run downloads its toolchain
# from the network, so build with connectivity (or prime the emsdk cache).
# =============================================================================
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git xz-utils \
        build-essential python3 \
        nodejs \
    && rm -rf /var/lib/apt/lists/*

# Pinned emsdk (Emscripten). EMSDK_REF is the tag/commit; install + activate it.
ARG EMSDK_VERSION=3.1.69
RUN git clone https://github.com/emscripten-core/emsdk /opt/emsdk \
    && cd /opt/emsdk \
    && ./emsdk install "${EMSDK_VERSION}" \
    && ./emsdk activate "${EMSDK_VERSION}"
ENV EMSDK_DIR=/opt/emsdk

WORKDIR /build
COPY nim-wasm/ /build/nim-wasm/
COPY versions.env /build/versions.env

VOLUME /out
ENV OUT=/out
CMD ["bash", "/build/nim-wasm/build.sh"]
