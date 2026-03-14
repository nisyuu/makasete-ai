import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { rateLimit } from 'express-rate-limit';
import { config } from './config';
import { fetchAllSheets, getAllSheetData, dataReadyPromise } from './services/sheets';
import { generateResponseStream } from './services/gemini';
import { getTTSService } from './services/tts/factory';
import { TTSService } from './services/tts/types';
import { StreamBuffer } from './utils/streamBuffer';
import { stripTags, cleanupForTTS, isSsml } from './utils/text';

const app = express();

// Security: Trust proxy for Cloud Run to get correct client IP for rate limiting
app.set('trust proxy', 1);

// Security: Use environment variable for allowed origins
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? (process.env.ALLOWED_ORIGINS.includes(',') ? process.env.ALLOWED_ORIGINS.split(',') : process.env.ALLOWED_ORIGINS)
    : "*";

// 1. CORS Middleware (Must be FIRST)
app.use(cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
}));

// Security: Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: "Too many requests from this IP, please try again later."
});

app.use(limiter);

const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"]
    }
});

// Security: Simple Socket.io rate limiting
const socketConnections = new Map<string, number>();

function getClientIp(socket: Socket): string {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    if (forwarded) {
        return (Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]).trim();
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
app.use('/public', express.static(path.join(__dirname, '../../dist/public')));

app.get('/health', async (req: Request, res: Response) => {
    await dataReadyPromise;
    res.json({ status: "ready" });
});

// API Endpoints
app.get('/api/:sheetName', async (req: Request, res: Response) => {
    await dataReadyPromise;
    const { sheetName } = req.params;

    // Security: Do not expose the prompt sheet via API
    if (sheetName === 'prompt') {
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
io.on('connection', (socket) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chatHistory: any[] = [];

    socket.on('user-input', async (data: { text: string; isVoiceInput: boolean }) => {
        const { text, isVoiceInput } = data;
        
        if (!text || typeof text !== 'string' || text.length > 1000) {
            socket.emit('error', { message: "Input is invalid" });
            return;
        }

        chatHistory.push({ role: "user", parts: [{ text }] });

        if (chatHistory.length > 20) {
            chatHistory.splice(0, 2);
        }

        const streamBuffer = new StreamBuffer();

        try {
            // 1. Get Gemini Stream
            const stream = await generateResponseStream(text, chatHistory);
            const ttsService = getTTSService();

            let fullResponseText = "";

            for await (const chunk of stream) {
                const chunkText = chunk.text();
                fullResponseText += chunkText;

                // Buffer and split by sentences
                const sentences = streamBuffer.add(chunkText);

                for (const sentence of sentences) {
                    await processSentence(socket, sentence, isVoiceInput, ttsService);
                }
            }

            // Flush remaining buffer
            const remaining = streamBuffer.flush();
            if (remaining) {
                await processSentence(socket, remaining, isVoiceInput, ttsService);
            }

            // Add model response to history
            chatHistory.push({ role: "model", parts: [{ text: fullResponseText }] });

            // Signal end of turn
            socket.emit('response-complete');

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("Error processing input:", message);
            socket.emit('error', { message: "Internal server error occurred." });
        }
    });

    socket.on('disconnect', () => {
        const clientIp = getClientIp(socket);
        const count = socketConnections.get(clientIp);
        if (count && count > 1) {
            socketConnections.set(clientIp, count - 1);
        } else {
            socketConnections.delete(clientIp);
        }
    });
});

async function processSentence(socket: Socket, sentence: string, isVoiceInput: boolean, ttsService: TTSService) {
    // 1. Prepare text for UI by removing SSML tags
    const uiText = stripTags(sentence);

    if (isVoiceInput) {
        // Send clean text to UI
        socket.emit('audio-chunk', { type: 'text', content: uiText });

        try {
            // 2. Prepare text for TTS
            const ttsInput = isSsml(sentence) ? sentence : cleanupForTTS(sentence);

            if (!ttsInput) return;

            const audioStream: NodeJS.ReadableStream = await ttsService.generateSpeechStream(ttsInput);

            const chunks: Buffer[] = [];
            audioStream.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });

            await new Promise((resolve, reject) => {
                audioStream.on('end', () => {
                    const fullBuffer = Buffer.concat(chunks);
                    socket.emit('audio-chunk', { type: 'audio', content: fullBuffer });
                    setTimeout(resolve, 50); // Minimal gap
                });
                audioStream.on('error', (err) => {
                    console.error("[TTS] Stream error:", err);
                    reject(err);
                });
            });

        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            console.error("TTS Error:", message);
        }
    } else {
        socket.emit('text-chunk', { content: uiText });
    }
}

// Start Server
const PORT = config.port;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
