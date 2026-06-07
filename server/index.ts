import express, { Request, Response } from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import cors from "cors";
import path from "path";
import { rateLimit } from "express-rate-limit";
import { config } from "./config";
import {
  fetchAllSheets,
  getAllSheetData,
  dataReadyPromise,
} from "./services/sheets";
import { registerConnectionHandler } from "./handlers/socketConnectionHandler";

const app = express();

// Security: Trust proxy for Cloud Run to get correct client IP for rate limiting
app.set("trust proxy", 1);

// Security: Use environment variable for allowed origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.includes(",")
    ? process.env.ALLOWED_ORIGINS.split(",")
    : process.env.ALLOWED_ORIGINS
  : "*";

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

// Security: Simple Socket.io rate limiting
const socketConnections = new Map<string, number>();

function getClientIp(socket: Socket): string {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (forwarded) {
    return (
      Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0]
    ).trim();
  }
  return socket.handshake.address;
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

// Initialize caching
fetchAllSheets().then(() => {
  console.log("Initial data fetch (all sheets) complete.");
});

// WebSocket logic
io.on("connection", (socket) =>
  registerConnectionHandler(socket, socketConnections, getClientIp),
);

// Start Server
const PORT = config.port;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
