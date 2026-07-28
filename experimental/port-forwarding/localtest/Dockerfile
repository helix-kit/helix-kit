# Single-container acceptance test: Python web app + Helix port-forwarding agent.
# Build context is the port-forwarding/ root so we can pull in the agent source.
#
#   docker build -f localtest/Dockerfile -t helix-localtest .
#   docker run --rm -e SESSION_ID=demo helix-localtest

FROM golang:1.22-alpine AS build
WORKDIR /src
COPY agent/go.mod agent/go.sum* ./
RUN go mod download
COPY agent/*.go ./
RUN CGO_ENABLED=0 go build -o /out/port-agent .

FROM python:3.12-alpine
RUN apk add --no-cache ca-certificates
COPY --from=build /out/port-agent /usr/local/bin/port-agent
COPY localtest/server.py /app/server.py
COPY localtest/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
ENV SESSION_ID=demo APP_PORT=8000
ENTRYPOINT ["/app/entrypoint.sh"]
