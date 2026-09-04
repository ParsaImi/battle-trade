# --- stage 1: build the static bundle -------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_WS_URL is inlined at build time, not runtime. Leave it unset for the
# normal single-origin deploy (the client then uses /ws on its own origin);
# pass it only when the backend lives on a different host.
ARG VITE_WS_URL=""
ENV VITE_WS_URL=$VITE_WS_URL
RUN npm run build

# --- stage 2: serve it, and proxy the WebSocket ---------------------------
FROM nginx:alpine

# openssl is only needed for the self-signed fallback certificate.
RUN apk add --no-cache openssl

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY app-locations.conf /etc/nginx/app-locations.conf
COPY docker-entrypoint.sh /docker-entrypoint-tls.sh
RUN chmod +x /docker-entrypoint-tls.sh
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80 443
ENTRYPOINT ["/docker-entrypoint-tls.sh"]
CMD ["nginx", "-g", "daemon off;"]
