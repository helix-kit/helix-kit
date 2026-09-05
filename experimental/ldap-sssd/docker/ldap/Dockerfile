# SPDX-License-Identifier: AGPL-3.0-only
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -o /out/helix-ldap ./cmd/helix-ldap

FROM alpine:3.22
# netcat is only here so compose can health-check the listener.
RUN apk add --no-cache netcat-openbsd ca-certificates \
    && adduser -D -u 10001 helix
COPY --from=build /out/helix-ldap /usr/local/bin/helix-ldap
USER helix
EXPOSE 3389
# Runs in the foreground as PID 1 so SIGTERM reaches it directly.
ENTRYPOINT ["/usr/local/bin/helix-ldap"]
