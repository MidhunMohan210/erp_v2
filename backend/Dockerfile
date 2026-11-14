
# 1. Use Node.js 22 with a lightweight Linux base
FROM node:22-bookworm-slim

# 2. Set the working directory
WORKDIR /app/backend

# 3. Copy dependency files first for Docker caching
COPY backend/package.json backend/package-lock.json ./

# 4. Install production dependencies only
RUN npm ci --omit=dev

# 5. Copy backend source code
COPY backend/ ./

# 6. Copy shared code required by the backend
COPY shared/ /app/shared/

# 7. Document the backend's internal port
EXPOSE 4000

# 8. Run the application as a non-root user
USER node

# 9. Start the Express backend
CMD ["node", "server.js"]
