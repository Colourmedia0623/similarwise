# Docker Hub rate-limits the shared GitHub runners (429); AWS mirrors the
# official Node images without that limit.
FROM public.ecr.aws/docker/library/node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM public.ecr.aws/docker/library/node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "run", "docker-start"]
