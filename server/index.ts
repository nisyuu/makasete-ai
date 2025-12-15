import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import { fetchProducts, getProducts, fetchNews, getNews } from './services/sheets';
import { generateResponseStream } from './services/gemini';
import { generateSpeechStream } from './services/tts';
import { StreamBuffer } from './utils/streamBuffer';

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
Promise.all([fetchProducts(), fetchNews()]).then(() => {
    console.log("Initial data fetch (books & news) complete.");
});

// WebSocket logic
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    let chatHistory: any[] = [];

    socket.on('user-input', async (data: { text: string; isVoiceInput: boolean }) => {
        const { text, isVoiceInput } = data;
        console.log(`Received input: ${text}, isVoice: ${isVoiceInput}`);

        // Add user message to history
        chatHistory.push({ role: "user", parts: [{ text }] });

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

async function processSentence(socket: Socket, sentence: string, isVoiceInput: boolean) {
    // Determine if we should send audio or just text
    if (isVoiceInput) {
        // Send text first (for UI display)
        socket.emit('audio-chunk', { type: 'text', content: sentence });

        try {
            // Generate Audio
            // Remove markdown links for TTS (e.g. "[Book Title](/books/1)" -> "Book Title")
            const cleanSentence = removeMarkdownLinks(sentence);
            const audioStream = await generateSpeechStream(cleanSentence);

            // Stream audio chunks
            audioStream.on('data', (chunk: Buffer) => {
                socket.emit('audio-chunk', { type: 'audio', content: chunk });
            });

            // We need to wait for the stream to finish before returning to ensure order?
            // For simple implementation, we might risk overlapping if next sentence comes too fast.
            // But ElevenLabs is fast. Real production might need a queue.
            // For this MVP, let's wrap in a promise.
            await new Promise((resolve, reject) => {
                audioStream.on('end', resolve);
                audioStream.on('error', reject);
            });

        } catch (e) {
            console.error("TTS Error:", e);
            // Fallback to text only if TTS fails?
        }
    } else {
        // Text mode: just send text
        socket.emit('text-chunk', { content: sentence });
    }
}

// Start Server
const PORT = config.port;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Define Socket type for helper function
type Socket = any;

function removeMarkdownLinks(text: string): string {
    // Replaces [Link Text](URL) with Link Text
    return text.replace(/\[((?:[^\[\]]|\[[^\]]*\])+)\]\(([^)]+)\)/g, '$1');
} 
