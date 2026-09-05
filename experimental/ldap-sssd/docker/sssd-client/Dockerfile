# SPDX-License-Identifier: AGPL-3.0-only
FROM ubuntu:24.04

# sssd-ldap carries the LDAP identity provider, libnss-sss the NSS module that
# glibc loads for `getent`/`id`, sssd-tools `sss_cache`, ldap-utils `ldapsearch`.
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        sssd \
        sssd-ldap \
        sssd-tools \
        libnss-sss \
        ldap-utils \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY docker/sssd-client/nsswitch.conf /etc/nsswitch.conf
COPY docker/sssd-client/sssd.conf /etc/sssd/sssd.conf
COPY docker/sssd-client/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
