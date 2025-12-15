FROM node:20-slim

WORKDIR /app

# Copy package info
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

# Install dependencies (frozen lockfile for stability)
RUN yarn install --immutable

# Copy source code
COPY . .

# Build widget and server
RUN yarn build

# Expose port
EXPOSE 8080

# Start server
CMD ["yarn", "start:prod"]
