# Docker Hub and the AWS mirror both rate-limit the shared GitHub runners (429);
# Google's mirror of the official Node images is used instead.
FROM mirror.gcr.io/library/node:22-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM mirror.gcr.io/library/node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "run", "docker-start"]
