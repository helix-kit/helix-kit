# Experimental Helix port-forwarding gateway.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

ENV PORT=9000
ENV BASE_DOMAIN=port.helix-kit.com
EXPOSE 9000

CMD ["npx", "tsx", "src/index.ts"]
