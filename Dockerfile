FROM node:20-slim

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package info
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build widget and server
RUN pnpm build

# Expose port
EXPOSE 8080

# Start server
CMD ["pnpm", "start:prod"]
