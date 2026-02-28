import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { fetchProducts, getProducts, fetchNews, getNews, fetchSystemPrompt } from './services/sheets';
import { generateResponse } from './services/gemini';
import { generateSpeechStream } from './services/tts';
import { transcodeToFmp4 } from './services/transcode';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // Allow all origins for the widget
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
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
        const { text, isVoiceInput, isIOS } = data;
        console.log(`Received input: ${text}, isVoice: ${isVoiceInput}`);

        // Add user message to history
        chatHistory.push({ role: "user", parts: [{ text }] });

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

                    if (isIOS) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        audioStream = transcodeToFmp4(audioStream as any) as any;
                    }

                    audioStream.on('data', (chunk: Buffer) => {
                        socket.emit('audio-chunk', { type: 'audio', content: chunk });
                    });

                    await new Promise((resolve, reject) => {
                        audioStream.on('end', resolve);
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

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (error: any) {
            console.error("Error processing input:", error);
            const errorMessage = error?.message || "Unknown error";
            socket.emit('error', { message: `Processing error: ${errorMessage}` });
        }
    });

    socket.on('disconnect', () => {
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
