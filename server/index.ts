import express, { NextFunction, Request, Response } from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import path from "path";
import { rateLimit } from "express-rate-limit";
import { config, validateConfig } from "./config";
import {
  fetchAllSheets,
  getAllSheetData,
  dataReadyPromise,
  isDataReady,
} from "./services/sheets";
import { ChatService, resolveRequestId } from "./services/chat";
import { isOriginAllowed, parseAllowedOrigins } from "./utils/origin";
import { resolveClientIp } from "./utils/clientIp";
import { TokenBucketLimiter } from "./utils/rateLimiter";
import { installProcessHandlers } from "./utils/processHandlers";

// 設定漏れを起動時に報告する（最初のチャットで初めて気付く事態を避ける）
const missingConfig = validateConfig();
if (missingConfig.length > 0) {
  console.error(
    `[config] Missing required environment variables: ${missingConfig.join(", ")}`,
  );
}

const app = express();

// Security: Trust proxy for Cloud Run to get correct client IP for rate limiting
const TRUSTED_PROXY_COUNT = 1;
app.set("trust proxy", TRUSTED_PROXY_COUNT);

// Security: Use environment variable for allowed origins
const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

// 1. CORS Middleware (Must be FIRST)
// credentials は使わない: Cookie も Authorization も送らないため不要で、
// origin "*" と併用するとブラウザ側でリクエストが拒否される。
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  }),
);

// Security: Rate limiting
//
// ウィジェットは 1 ページ表示ごとに widget.js / /health / /api/settings を叩く。
// 全ルートを一つの厳しい上限で縛ると、企業 NAT や CGNAT の背後にいる複数ユーザーが
// 同一 IP とみなされて数十ページビューでウィジェットごと 429 になる。静的配信と
// 読み取り API は緩く、それ以外は厳しく、と経路ごとに分ける。
const staticLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 1000,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later.",
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later.",
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
  // Security: cors の origin 設定は不一致でもヘッダを付けないだけで接続を拒否せず、
  // engine.io 自身も Origin を検証しない。WebSocket 直結（transports: ["websocket"]）
  // なら第三者サイトからそのまま接続できてしまうため、ハンドシェイク時に明示的に
  // Origin を照合して拒否する。
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    if (isOriginAllowed(origin, allowedOrigins)) {
      return callback(null, true);
    }
    console.warn(`[Socket] Rejected handshake from disallowed origin: ${origin}`);
    return callback("origin not allowed", false);
  },
  // Firebase App Hosting (Cloud Run 前段のプロキシ) は末尾スラッシュを除去して
  // リクエストを転送するため、既定の `/socket.io/` では engine.io がパスを
  // 認識できず 404 になる。`addTrailingSlash: false` で `/socket.io`（末尾
  // スラッシュ無し）も受け付けるようにし、どちらの形式でもハンドシェイクを
  // 成立させる。
  addTrailingSlash: false,
});

// Security: Simple Socket.io rate limiting
const socketConnections = new Map<string, number>();

// Security: user-input は 1 件ごとに LLM ストリームと文単位の TTS を発火させ、
// そのまま課金につながる。接続単位と IP 単位の両方で上限を設ける。
const socketEventLimiter = new TokenBucketLimiter({
  capacity: 10,
  refillPerSecond: 10 / 60, // 10 requests per minute, burst 10
});
const ipEventLimiter = new TokenBucketLimiter({
  capacity: 30,
  refillPerSecond: 30 / 60, // 30 requests per minute, burst 30
});

// 放置されたバケットを定期的に回収する（満タンに戻ったものだけ削除）
const limiterPruneTimer = setInterval(
  () => {
    socketEventLimiter.prune();
    ipEventLimiter.prune();
  },
  5 * 60 * 1000,
);
limiterPruneTimer.unref();

function getClientIp(socket: Socket): string {
  return resolveClientIp(
    socket.handshake.headers["x-forwarded-for"],
    socket.handshake.address,
    TRUSTED_PROXY_COUNT,
  );
}

io.use((socket, next) => {
  const clientIp = getClientIp(socket);
  const count = socketConnections.get(clientIp) || 0;
  if (count >= 5) {
    return next(new Error("Too many connections"));
  }
  socketConnections.set(clientIp, count + 1);
  next();
});

// Middleware
app.use(express.json({ limit: "64kb" }));

// Static files (Widget)
app.use(
  "/public",
  staticLimiter,
  express.static(path.join(process.cwd(), "dist/public")),
);

// Demo Page
app.get("/demo", staticLimiter, (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), "dist/public/demo.html"));
});

app.get("/health", staticLimiter, async (req: Request, res: Response) => {
  await dataReadyPromise;
  // Sheets の取得に失敗していれば「準備完了」を名乗らない。空のキャッシュのまま
  // ready を返すと、プロンプトも知識も無いインスタンスに Cloud Run がトラフィックを
  // 流してしまう。
  if (!isDataReady()) {
    return res.status(503).json({ status: "unavailable" });
  }
  res.json({ status: "ready" });
});

// API Endpoints
app.get("/api/:sheetName", staticLimiter, async (req: Request, res: Response) => {
  await dataReadyPromise;
  const { sheetName } = req.params;

  if (typeof sheetName !== "string") {
    return res.status(400).json({ error: "Invalid sheet name" });
  }

  // Security: Do not expose the prompt sheet via API
  if (sheetName === "prompt") {
    return res.status(404).json({ error: "Sheet 'prompt' not found" });
  }

  const data = getAllSheetData();
  const sheetData = data.get(sheetName);

  if (sheetData) {
    res.json(sheetData);
  } else {
    res.status(404).json({ error: `Sheet '${sheetName}' not found` });
  }
});

// 上で個別に limiter を付けていない経路（今後追加される POST など）には
// 厳しい方の上限を適用する。
app.use(apiLimiter);

// Security: エラー応答にスタックトレースを含めない。Express 既定のエラーハンドラは
// NODE_ENV=production 以外だと err.stack を返し、絶対パスなどの内部情報が漏れる。
app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[HTTP] Unhandled error:", message);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: "Internal server error" });
});

// Initialize caching
fetchAllSheets().then(() => {
  console.log("Initial data fetch (all sheets) complete.");
});

// WebSocket logic
io.on("connection", (socket) => {
  const chatService = new ChatService();
  const clientIp = getClientIp(socket);

  socket.on(
    "user-input",
    (data: {
      text: string;
      isVoiceInput: boolean;
      language?: string;
      requestId?: unknown;
    }) => {
      if (
        !socketEventLimiter.tryConsume(socket.id) ||
        !ipEventLimiter.tryConsume(clientIp)
      ) {
        const requestId =
          data !== null && typeof data === "object"
            ? resolveRequestId(data.requestId)
            : undefined;
        socket.emit("error", {
          message: "Too many requests. Please wait a moment and try again.",
          ...(requestId === undefined ? {} : { requestId }),
        });
        return;
      }

      // handleUserInput は async。await も catch もしないと、投げられた例外が
      // unhandled rejection となり Node 24 の既定設定ではプロセスごと落ちる。
      void chatService.handleUserInput(socket, data).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[Socket] handleUserInput failed:", message);
        socket.emit("error", { message: "Internal server error occurred." });
      });
    },
  );

  socket.on("disconnect", () => {
    // 聞き手がいなくなった生成を打ち切り、Gemini の課金を止める
    chatService.dispose();
    socketEventLimiter.release(socket.id);
    const count = socketConnections.get(clientIp);
    if (count && count > 1) {
      socketConnections.set(clientIp, count - 1);
    } else {
      socketConnections.delete(clientIp);
    }
  });
});

// Safety net: 拾い損ねた Promise の reject ではプロセスを落とさず、
// 同期処理の途中で突き抜けた例外では接続を閉じてから終了する（Cloud Run が再起動）。
// 詳細は server/utils/processHandlers.ts を参照。
// io.close() は接続中のソケットを切断してから内部の httpServer も閉じる。
installProcessHandlers(process, { server: io });

// Start Server
const PORT = config.port;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
