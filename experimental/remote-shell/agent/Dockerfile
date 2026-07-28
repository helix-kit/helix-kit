# Experimental Helix remote-shell device agent.
# The final image is the "device": the browser shell lands in THIS container.
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -o /out/shell-agent .

FROM debian:stable-slim
# Full vim, not vim-tiny: vim-tiny's stripped redraw defers the insert-mode
# backspace erase, leaving ghost characters until the next full redraw.
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates procps curl less nano vim iproute2 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/shell-agent /usr/local/bin/shell-agent
# Debian ships the built-in C.UTF-8 locale (no locale-gen needed); a UTF-8
# locale is required by TUI apps like btop. os.Environ() passes this to the PTY.
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8
ENV SHELL_BIN=/bin/bash
# A friendly prompt so the demo shell looks like a real device.
RUN echo 'export PS1="\[\e[32m\]helix-device\[\e[0m\]:\[\e[34m\]\w\[\e[0m\]\$ "' >> /etc/bash.bashrc
ENTRYPOINT ["/usr/local/bin/shell-agent"]
