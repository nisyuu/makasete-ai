# ---- Build stage ----
# ビルドには devDependencies（vite / tsc）が必要なので、ビルド専用の段を分ける。
# 最終イメージにはビルド成果物と本番依存だけを持ち込み、ソースや開発用ツール、
# 誤ってコピーされうる資格情報がレイヤーに残らないようにする。
FROM node:24-slim AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# 本番依存だけを残す（devDependencies を削ぎ落とす）
RUN pnpm prune --prod

# ---- Runtime stage ----
FROM node:24-slim AS runtime

# Express の既定エラーハンドラは production 以外だとスタックトレースを
# レスポンスに含める。本番イメージでは必ず production にする。
ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Security: root で実行しない。node イメージには非 root の `node` ユーザーが
# あらかじめ用意されている。
USER node

EXPOSE 8080

# pnpm を介さず直接起動する（実行段に pnpm を入れないため）
CMD ["node", "dist/server/index.js"]
