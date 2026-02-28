FROM node:24-slim

# Install ffmpeg and clean up
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

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
