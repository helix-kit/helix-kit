FROM debian:bullseye
# bullseye, not trixie: the board runs glibc 2.31, so the cross toolchain must not
# emit references to a newer symbol version. build-essential is needed alongside the
# cross compiler because ggml builds a few code generators that run on the HOST.
RUN apt-get update && apt-get install -y --no-install-recommends \
      crossbuild-essential-arm64 build-essential cmake git ca-certificates make \
    && rm -rf /var/lib/apt/lists/*
