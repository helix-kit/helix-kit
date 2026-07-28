FROM eclipse-mosquitto:2

# curl + openssl let the entrypoint pull step-ca's CRL and normalise it to PEM
# so the broker can enforce device-cert revocation (crlfile in mosquitto.conf).
RUN apk add --no-cache curl openssl

COPY docker-entrypoint.sh /usr/local/bin/helix-mosquitto-entrypoint.sh

RUN chmod +x /usr/local/bin/helix-mosquitto-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/helix-mosquitto-entrypoint.sh"]
CMD ["mosquitto", "-c", "/mosquitto/config/mosquitto.conf"]
