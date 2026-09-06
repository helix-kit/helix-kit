# SPDX-License-Identifier: AGPL-3.0-only
#
# The user's machine: an OpenSSH client plus a PTY driver, because
# keyboard-interactive prompts are read from a terminal and not from stdin.

FROM ubuntu:24.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        openssh-client \
        python3 python3-pexpect \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY docker/ssh-client/ssh-login /usr/local/bin/ssh-login
COPY docker/ssh-client/auth-flow /usr/local/bin/auth-flow
RUN chmod 0755 /usr/local/bin/ssh-login /usr/local/bin/auth-flow

ENTRYPOINT ["sleep", "infinity"]
