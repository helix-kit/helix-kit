# Experimental Helix port-forwarding device agent.
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -o /out/port-agent .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
COPY --from=build /out/port-agent /usr/local/bin/port-agent
ENTRYPOINT ["/usr/local/bin/port-agent"]
