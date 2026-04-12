import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { ResponseOrchestrator } from './services/responseOrchestrator';
import { AIService } from './services/aiService';
import { registerSocketHandlers } from './handlers/socketHandlers';
import { logger } from './utils/logger';

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST'],
  },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const aiService = new AIService({
  apiKey: process.env.OPENAI_API_KEY || '',
  model: process.env.AI_MODEL || 'gpt-3.5-turbo',
  maxTokens: parseInt(process.env.MAX_TOKENS || '1024', 10),
  temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
});

const orchestrator = new ResponseOrchestrator(aiService);

// REST API routes
app.post('/api/chat', async (req, res) => {
  try {
    const { conversationId, message, systemPrompt } = req.body as {
      conversationId?: string;
      message: string;
      systemPrompt?: string;
    };

    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    const result = await orchestrator.processMessage(conversationId, message, systemPrompt);

    res.json({
      conversationId: result.conversationId,
      message: result.response,
      role: 'assistant',
    });
  } catch (error) {
    logger.error('Error in /api/chat', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.IO connection handler
io.on('connection', (socket) => {
  registerSocketHandlers(io, socket, orchestrator);
});

const PORT = parseInt(process.env.PORT || '3000', 10);

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

export { app, httpServer, io };
