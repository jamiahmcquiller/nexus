# NEXUS frontend — Vite dev server.
# Build from the repository root: docker build -f frontend/Dockerfile frontend
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173

# Vite proxies /api to the backend (see vite.config.ts); the compose
# file sets VITE_BACKEND_URL=http://backend:8000 for that proxy.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
