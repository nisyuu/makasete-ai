import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { rateLimit } from 'express-rate-limit';
import { config } from './config';
import { fetchProducts, getProducts, fetchNews, getNews, fetchSystemPrompt } from './services/sheets';
import { generateResponseStream } from './services/gemini';
import { getTTSService } from './services/tts/factory';
import { StreamBuffer } from './utils/streamBuffer';

const app = express();

// Security: Trust proxy for Cloud Run to get correct client IP for rate limiting
app.set('trust proxy', 1);

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

// Security: Use environment variable for allowed origins
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : "*";

const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"]
    }
});

// Security: Simple Socket.io rate limiting
const socketConnections = new Map<string, number>();

io.use((socket, next) => {
    const ip = socket.handshake.address;
    const count = socketConnections.get(ip) || 0;
    if (count >= 5) {
        return next(new Error("Too many connections"));
    }
    socketConnections.set(ip, count + 1);
    next();
});

// Middleware
app.use(cors({
    origin: allowedOrigins
}));
app.use(express.json());

// Static files (Widget)
app.use('/public', express.static(path.join(__dirname, '../../dist/public')));

// API Endpoints
app.get('/api/books', (req: Request, res: Response) => {
    const products = getProducts();
    res.json(products);
});

app.get('/api/news', (req: Request, res: Response) => {
    const news = getNews();
    res.json(news);
});

// Initialize caching
Promise.all([fetchProducts(), fetchNews(), fetchSystemPrompt()]).then(() => {
    console.log("Initial data fetch (books, news & prompt) complete.");
});

// WebSocket logic
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chatHistory: any[] = [];

    socket.on('user-input', async (data: { text: string; isVoiceInput: boolean; isIOS?: boolean }) => {
        const { text, isVoiceInput } = data;
        
        if (!text || typeof text !== 'string' || text.length > 1000) {
            socket.emit('error', { message: "Input too long or invalid" });
            return;
        }

        console.log(`Received input: ${text.substring(0, 50)}..., isVoice: ${isVoiceInput}`);

        chatHistory.push({ role: "user", parts: [{ text }] });

        if (chatHistory.length > 20) {
            chatHistory.splice(0, 2);
        }

        const streamBuffer = new StreamBuffer();

        try {
            // 1. Get Gemini Stream
            const stream = await generateResponseStream(text, chatHistory);

            let fullResponseText = "";

            for await (const chunk of stream) {
                const chunkText = chunk.text();
                fullResponseText += chunkText;

                // Buffer and split by sentences
                const sentences = streamBuffer.add(chunkText);

                for (const sentence of sentences) {
                    await processSentence(socket, sentence, isVoiceInput);
                }
            }

            // Flush remaining buffer
            const remaining = streamBuffer.flush();
            if (remaining) {
                await processSentence(socket, remaining, isVoiceInput);
            }

            // Add model response to history
            chatHistory.push({ role: "model", parts: [{ text: fullResponseText }] });

            // Signal end of turn
            socket.emit('response-complete');

        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("Error processing input:", message);
            socket.emit('error', { message: `Processing error: ${message}` });
        }
    });

    socket.on('disconnect', () => {
        const ip = socket.handshake.address;
        const count = socketConnections.get(ip) || 1;
        if (count <= 1) {
            socketConnections.delete(ip);
        } else {
            socketConnections.set(ip, count - 1);
        }
        console.log('Client disconnected:', socket.id);
    });
});

async function processSentence(socket: Socket, sentence: string, isVoiceInput: boolean) {
    if (isVoiceInput) {
        socket.emit('audio-chunk', { type: 'text', content: sentence });

        try {
            // Cleanup: remove links, emojis, and extra symbols for cleaner TTS
            const cleanSentence = removeMarkdownLinks(sentence)
                .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '') // Remove Emojis
                .replace(/[＊*#]/g, '') // Remove common markdown symbols
                .trim();

            if (!cleanSentence) return; // Skip if nothing to read

            const ttsService = getTTSService();
            console.log(`[${ttsService.getName()}] Generating audio for: "${cleanSentence.substring(0, 20)}..."`);
            const audioStream: NodeJS.ReadableStream = await ttsService.generateSpeechStream(cleanSentence);

            const chunks: Buffer[] = [];
            audioStream.on('data', (chunk: Buffer) => {
                chunks.push(chunk);
            });

            await new Promise((resolve, reject) => {
                audioStream.on('end', () => {
                    const fullBuffer = Buffer.concat(chunks);
                    console.log(`[TTS] Sending full audio buffer: ${fullBuffer.length} bytes`);
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
        socket.emit('text-chunk', { content: sentence });
    }
}

// Start Server
const PORT = config.port;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

function removeMarkdownLinks(text: string): string {
    return text.replace(/\[((?:[^[\]]|\[[^\]]*\])+)\]\(([^)]+)\)/g, '$1');
} 
