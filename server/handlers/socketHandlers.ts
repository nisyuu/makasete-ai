import { Server, Socket } from 'socket.io';
import { ResponseOrchestrator } from '../services/responseOrchestrator';
import { getOrCreateConversation } from '../services/conversationService';
import { logger } from '../utils/logger';

export function registerSocketHandlers(
  io: Server,
  socket: Socket,
  orchestrator: ResponseOrchestrator
): void {
  logger.info(`Client connected: ${socket.id}`);

  socket.on('chat:message', async (data: {
    conversationId?: string;
    message: string;
    systemPrompt?: string;
    stream?: boolean;
  }) => {
    try {
      logger.info(`Received message from ${socket.id}`, { conversationId: data.conversationId });

      if (data.stream) {
        for await (const chunk of orchestrator.processMessageStream(
          data.conversationId,
          data.message,
          data.systemPrompt
        )) {
          socket.emit('chat:chunk', chunk);
        }
      } else {
        const result = await orchestrator.processMessage(
          data.conversationId,
          data.message,
          data.systemPrompt
        );
        socket.emit('chat:response', {
          conversationId: result.conversationId,
          message: result.response,
          role: 'assistant',
        });
      }
    } catch (error) {
      logger.error('Error processing message', error);
      socket.emit('chat:error', {
        message: 'An error occurred while processing your message',
      });
    }
  });

  socket.on('conversation:get', (data: { conversationId: string }) => {
    try {
      const conversation = getOrCreateConversation(data.conversationId);
      socket.emit('conversation:data', conversation);
    } catch (error) {
      logger.error('Error getting conversation', error);
      socket.emit('chat:error', { message: 'Failed to retrieve conversation' });
    }
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
}
