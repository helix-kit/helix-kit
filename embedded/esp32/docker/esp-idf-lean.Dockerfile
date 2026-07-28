# syntax=docker/dockerfile:1.7

ARG UBUNTU_VERSION=24.04
FROM ubuntu:${UBUNTU_VERSION}

ARG DEBIAN_FRONTEND=noninteractive
ARG IDF_BRANCH=release/v5.4
ARG IDF_PATH=/opt/esp/idf
ARG IDF_TOOLS_PATH=/opt/esp/tools

ENV IDF_PATH=${IDF_PATH}
ENV IDF_TOOLS_PATH=${IDF_TOOLS_PATH}
ENV LC_ALL=C.UTF-8
ENV LANG=C.UTF-8
ENV PATH=${IDF_PATH}/tools:${PATH}

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bison \
      ca-certificates \
      ccache \
      cmake \
      curl \
      dfu-util \
      flex \
      git \
      gperf \
      libusb-1.0-0 \
      libffi-dev \
      libglib2.0-0 \
      libncurses-dev \
      libpixman-1-0 \
      libslirp0 \
      libssl-dev \
      ninja-build \
      python3 \
      python3-pip \
      python3-venv \
      udev \
      unzip \
      wget \
      xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,target=/opt/esp/tools/dist <<EOF
set -euo pipefail

retry() {
  local attempts="$1"
  shift
  local delay=5
  local attempt=1
  until "$@"; do
    if [ "${attempt}" -ge "${attempts}" ]; then
      return 1
    fi
    echo "Command failed, retrying in ${delay}s (${attempt}/${attempts}): $*" >&2
    sleep "${delay}"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

mkdir -p "$(dirname "${IDF_PATH}")" "${IDF_TOOLS_PATH}"
rm -rf "${IDF_PATH}"
retry 5 git clone --branch "${IDF_BRANCH}" --depth 1 https://github.com/espressif/esp-idf.git "${IDF_PATH}"
cd "${IDF_PATH}"
retry 5 git submodule update --init --recursive --depth 1 --jobs 1

"${IDF_PATH}/install.sh" all
rm -rf \
  "${IDF_PATH}/.git" \
  "${IDF_PATH}"/components/*/.git \
  "${IDF_PATH}"/components/*/*/.git \
  "${IDF_PATH}"/components/*/*/*/.git \
  /root/.cache \
  /tmp/*
EOF

RUN apt-get update \
    && apt-get install -y --no-install-recommends libsdl2-2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN --mount=type=cache,target=/opt/esp/tools/dist <<EOF
set -euo pipefail

retry() {
  local attempts="$1"
  shift
  local delay=5
  local attempt=1
  until "$@"; do
    if [ "${attempt}" -ge "${attempts}" ]; then
      return 1
    fi
    echo "Command failed, retrying in ${delay}s (${attempt}/${attempts}): $*" >&2
    sleep "${delay}"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

retry 5 "${IDF_TOOLS_PATH}/python_env/idf5.4_py3.12_env/bin/python" "${IDF_PATH}/tools/idf_tools.py" install qemu-xtensa qemu-riscv32
rm -rf /root/.cache /tmp/*
EOF

RUN apt-get update \
    && apt-get install -y --no-install-recommends jq \
    && rm -rf /var/lib/apt/lists/*

# pytest for the QEMU e2e suite (helix embedded esp32 qemu-test).
RUN "${IDF_TOOLS_PATH}/python_env/idf5.4_py3.12_env/bin/python" -m pip install --no-cache-dir pytest

WORKDIR /project

COPY embedded/esp32/docker/entrypoint.sh /opt/esp/entrypoint.sh
RUN chmod +x /opt/esp/entrypoint.sh

ENTRYPOINT ["/opt/esp/entrypoint.sh"]
CMD ["bash"]
