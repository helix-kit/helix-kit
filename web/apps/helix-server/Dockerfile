FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY apps/helix-server/dist ./dist

EXPOSE 4000 8443
CMD ["node", "dist/index.js"]
