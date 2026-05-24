# Stage 1: Builder
FROM node:20 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies required to compile TS)
RUN npm install

# Copy source code and TypeScript config
COPY . .

# Build the TypeScript project
RUN npm run build

# Prune devDependencies to save space, keeping only production modules
RUN npm prune --production

# Stage 2: Runner
FROM node:20 AS runner

WORKDIR /app

# Copy production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled source code
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Create data directory for SQLite database and ensure correct permissions
RUN mkdir -p /app/data && chown -R node:node /app/data

# Use a non-root user for security
USER node

# Expose the API port
EXPOSE 3000

# Set environment variables for the application
ENV NODE_ENV=production
ENV DATABASE_URL=/app/data/neuralswarm.db

# Start the application
CMD ["npm", "start"]
