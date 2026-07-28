# Experimental Helix remote-shell gateway: builds the React UI and serves it
# alongside the PTY relay WebSockets. Build context is remote-shell/.
#
#   docker build -f Dockerfile -t helix-shell-gateway .

# --- stage 1: build the React terminal UI ---
FROM node:22-alpine AS ui
WORKDIR /ui
COPY ui/package.json ./
RUN npm install --no-audit --no-fund
COPY ui/ ./
RUN npm run build

# --- stage 2: gateway that serves the built UI + relays PTY ---
FROM node:22-alpine
WORKDIR /app
COPY gateway/package.json ./
RUN npm install --no-audit --no-fund
COPY gateway/tsconfig.json ./
COPY gateway/src ./src
COPY --from=ui /ui/dist ./public

ENV PORT=9100
ENV STATIC_DIR=/app/public
EXPOSE 9100
CMD ["npx", "tsx", "src/index.ts"]
