import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { rateLimit } from 'express-rate-limit'; // Add this
import { config } from './config';
import { fetchProducts, getProducts, fetchNews, getNews, fetchSystemPrompt } from './services/sheets';
import { generateResponse } from './services/gemini';
import { generateSpeechStream } from './services/tts';
import { transcodeToFmp4 } from './services/transcode';

const app = express();

// Security: Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100, // Limit each IP to 100 requests per `window`
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: "Too many requests from this IP, please try again later."
});

app.use(limiter);

const httpServer = createServer(app);

// Security: Use environment variable for allowed origins, fallback to * for dev if needed
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',') 
    : "*";

const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"]
    }
});

// Security: Simple Socket.io rate limiting (connections per IP)
const socketConnections = new Map<string, number>();

io.use((socket, next) => {
    const ip = socket.handshake.address;
    const count = socketConnections.get(ip) || 0;
    if (count >= 5) { // Max 5 concurrent connections per IP
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

// Health check
app.get('/health', (req: Request, res: Response) => {
    res.status(200).send('OK');
});

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
        
        // Security: Limit input length to prevent DoS/Resource exhaustion
        if (!text || typeof text !== 'string' || text.length > 1000) {
            socket.emit('error', { message: "Input too long or invalid" });
            return;
        }

        console.log(`Received input: ${text.substring(0, 50)}..., isVoice: ${isVoiceInput}`);

        // Add user message to history
        chatHistory.push({ role: "user", parts: [{ text }] });

        // Security: Truncate chat history to prevent context window blowup and cost spikes
        if (chatHistory.length > 20) { // Keep only last 10 turns (20 roles)
            chatHistory.splice(0, 2);
        }

        try {
            // 1. Get Gemini Structured Response
            const response = await generateResponse(text, chatHistory);
            const { answer, display_text, recommended_ids } = response;

            // 2. Process for output
            if (isVoiceInput) {
                // In voice mode, send display text first
                socket.emit('audio-chunk', { type: 'text', content: display_text });

                // Generate and stream audio for the 'answer' field
                try {
                    const cleanAnswer = removeMarkdownLinks(answer);
                    let audioStream: NodeJS.ReadableStream = await generateSpeechStream(cleanAnswer);

                    // Always transcode to fMP4 for consistent MSE compatibility across browsers
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    audioStream = transcodeToFmp4(audioStream as any);

                    audioStream.on('data', (chunk: Buffer) => {
                        socket.emit('audio-chunk', { type: 'audio', content: chunk });
                    });

                    await new Promise((resolve, reject) => {
                        audioStream.on('end', () => {
                            // Add a tiny buffer between sentences
                            setTimeout(resolve, 300);
                        });
                        audioStream.on('error', reject);
                    });
                } catch (e) {
                    console.error("TTS Error:", e);
                }
            } else {
                // Text mode: send display text
                socket.emit('text-chunk', { content: display_text });
            }

            // Add model response to history (as string for Gemini history)
            chatHistory.push({ role: "model", parts: [{ text: JSON.stringify(response) }] });

            // Signal end of turn with extra data if any
            socket.emit('response-complete', { recommended_ids });

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

// Start Server
const PORT = config.port;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Define Socket type for helper function


function removeMarkdownLinks(text: string): string {
    // Replaces [Link Text](URL) with Link Text
    return text.replace(/\[((?:[^[\]]|\[[^\]]*\])+)\]\(([^)]+)\)/g, '$1');
} 
