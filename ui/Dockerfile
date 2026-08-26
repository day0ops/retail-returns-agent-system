FROM node:22-alpine AS builder
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 onward: the BFF (server/) needs a real Node process, not static
# nginx -- it holds the demo customer's token server-side and proxies to
# support-triage. It also serves the built static frontend itself now.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /src/dist ./dist
COPY --from=builder /src/dist-server ./dist-server
EXPOSE 80
CMD ["npm", "start"]
