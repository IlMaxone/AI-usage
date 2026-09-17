FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
RUN mkdir -p /opt/ocr-cache \
  && node -e "const {createWorker}=require('tesseract.js'); (async()=>{const w=await createWorker('eng',1,{cachePath:'/opt/ocr-cache'}); await w.terminate()})().catch(e=>{console.error(e);process.exit(1)})" \
  && test -f /opt/ocr-cache/eng.traineddata
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev --no-audit

FROM node:24-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --home-dir /app app \
  && mkdir -p /data/uploads /data/ocr-cache \
  && chown -R app:app /app /data
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /opt/ocr-cache /opt/ocr-cache
USER app
EXPOSE 3000
CMD ["node", "dist/main.js"]
