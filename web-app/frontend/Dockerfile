FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY angular.json tsconfig.json tsconfig.app.json ./
COPY public ./public
COPY src ./src
ARG PUBLIC_API_URL=http://localhost:3000/api
RUN sed -i "s|http://localhost:3000/api|${PUBLIC_API_URL}|g" src/api-url.ts && npm run build

FROM nginx:1.29-alpine AS production
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ai-usage/browser /usr/share/nginx/html
EXPOSE 80
