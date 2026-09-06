# SPDX-License-Identifier: AGPL-3.0-only
#
# The Helix device: LDAP/SSSD identity, sshd, pam_helix.so and helix-authd.

# helix-authd is built from the real device runtime, not a lab copy.
# CGO_ENABLED=0 matches how the runtime ships everywhere else (static,
# cross-compilable); authd reaches NSS through getent rather than os/user
# precisely so that stays true.
FROM golang:1.26-bookworm AS authd
WORKDIR /src
COPY --from=device-go go.mod go.sum ./
RUN go mod download
COPY --from=device-go . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/helix-authd ./cmd/helix-authd

FROM ubuntu:24.04 AS pam
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        gcc libc6-dev libpam0g-dev libjansson-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY pam/pam_helix.c ./
RUN mkdir -p /out && gcc -std=c11 -O2 -Wall -Wextra -Werror -fPIC -shared \
        -o /out/pam_helix.so pam_helix.c -lpam -ljansson

FROM ubuntu:24.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        sssd sssd-ldap sssd-tools libnss-sss ldap-utils \
        openssh-server \
        libjansson4 \
        python3-minimal \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=authd /out/helix-authd /usr/local/bin/helix-authd
# PAM's module directory is multiarch-qualified, so derive it rather than
# hardcoding x86_64: the Helix appliance and the Radxa boards are arm64.
COPY --from=pam /out/pam_helix.so /tmp/pam_helix.so
RUN install -D -m 0644 /tmp/pam_helix.so "/usr/lib/$(uname -m)-linux-gnu/security/pam_helix.so" \
    && rm /tmp/pam_helix.so

# Identity configuration is reused verbatim from the LDAP/SSSD lab rather than
# copied, so the two experiments can never drift apart on what identity means.
COPY --from=ldap-lab docker/sssd-client/nsswitch.conf /etc/nsswitch.conf
COPY --from=ldap-lab docker/sssd-client/sssd.conf /etc/sssd/sssd.conf
COPY docker/device/sshd_config /etc/ssh/sshd_config.d/helix.conf
COPY docker/device/pam-sshd /etc/pam.d/sshd
COPY docker/device/helix-config.json /etc/helix/config.json
COPY docker/device/helix-authd.json /etc/helix/conf.d/helix-authd.json
COPY docker/device/helix-auth-success /usr/local/bin/helix-auth-success
COPY docker/device/entrypoint.sh /usr/local/bin/entrypoint.sh
# Lab-only helpers the e2e harness uses to drive the daemon's state.
COPY docker/device/set-stub-decision /usr/local/bin/set-stub-decision
COPY docker/device/set-cloud-url /usr/local/bin/set-cloud-url
COPY docker/device/stop-authd /usr/local/bin/stop-authd
RUN chmod 0755 /usr/local/bin/helix-auth-success /usr/local/bin/entrypoint.sh \
    /usr/local/bin/set-stub-decision /usr/local/bin/set-cloud-url /usr/local/bin/stop-authd

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
