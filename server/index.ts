import express, { Request, Response } from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { rateLimit } from "express-rate-limit";
import { config } from "./config";
import {
  fetchAllSheets,
  getAllSheetData,
  dataReadyPromise,
} from "./services/sheets";
import { ChatService } from "./services/chatService";
import { TTSService } from "./services/ttsService";
import { ResponseOrchestrator } from "./services/responseOrchestrator";
import { registerSocketHandlers } from "./handlers/socketHandlers";
import { logger } from "./utils/logger";

const app = express();

// Security: Trust proxy for Cloud Run to get correct client IP for rate limiting
app.set("trust proxy", 1);

function parseAllowedOrigins(): string | string[] {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) return "*";
  return raw.includes(",") ? raw.split(",") : raw;
}

// Security: Use environment variable for allowed origins
const allowedOrigins = parseAllowedOrigins();

// 1. CORS Middleware (Must be FIRST)
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// Security: Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later.",
});

app.use(limiter);

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(express.json());

// Static files (Widget)
app.use("/public", express.static(path.join(process.cwd(), "dist/public")));

// Demo Page
app.get("/demo", (req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), "dist/public/demo.html"));
});

app.get("/health", async (req: Request, res: Response) => {
  await dataReadyPromise;
  res.json({ status: "ready" });
});

// API Endpoints
app.get("/api/:sheetName", async (req: Request, res: Response) => {
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

// Initialize sheet data cache
fetchAllSheets().then(() => {
  logger.info("Initial data fetch (all sheets) complete.");
});

// Dependency injection (Composition Root)
const chatService = new ChatService();
const ttsService = new TTSService();
const orchestrator = new ResponseOrchestrator(chatService, ttsService);

// Register WebSocket handlers (Controller layer)
registerSocketHandlers(io, orchestrator);

// Start Server
const PORT = config.port;
httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
