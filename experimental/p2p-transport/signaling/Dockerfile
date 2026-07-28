# Experimental Helix P2P signaling server: relays WebRTC SDP/ICE between two
# room peers and serves the web client. Build context is p2p-transport/ (needs
# both signaling/ and web/).
#
#   docker build -f signaling/Dockerfile -t helix-p2p-signaling .

FROM node:22-alpine
WORKDIR /app
COPY signaling/package.json ./signaling/
RUN cd signaling && npm install --no-audit --no-fund
COPY signaling/tsconfig.json ./signaling/
COPY signaling/src ./signaling/src
COPY web ./web

ENV PORT=9200
ENV STATIC_DIR=/app/web
EXPOSE 9200
# tsx is installed under signaling/node_modules, so run from there.
CMD ["sh", "-c", "cd signaling && npx tsx src/index.ts"]
