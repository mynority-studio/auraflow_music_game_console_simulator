FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM nginx:1.27-alpine

RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

RUN apk add --no-cache openssl curl
COPY docker/nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

# COPY docker/entrypoint.sh /entrypoint.sh
# RUN chmod +x /entrypoint.sh

EXPOSE 80

# ENV BASIC_AUTH_USERNAME="" BASIC_AUTH_PASSWORD=""
# ENTRYPOINT ["/entrypoint.sh"]