import { AIService } from './aiService';
import { Message } from '../types';
import { logger } from '../utils/logger';
import { getOrCreateConversation, addMessage } from './conversationService';

export class ResponseOrchestrator {
  private aiService: AIService;

  constructor(aiService: AIService) {
    this.aiService = aiService;
  }

  async processMessage(
    conversationId: string | undefined,
    userMessage: string,
    systemPrompt?: string
  ): Promise<{ conversationId: string; response: string }> {
    const conversation = getOrCreateConversation(conversationId);

    if (systemPrompt && conversation.messages.length === 0) {
      const systemMessage: Message = {
        role: 'system',
        content: systemPrompt,
      };
      addMessage(conversation.id, systemMessage);
    }

    const userMsg: Message = {
      role: 'user',
      content: userMessage,
    };
    addMessage(conversation.id, userMsg);

    logger.info(`Processing message for conversation ${conversation.id}`);

    const response = await this.aiService.generateResponse(conversation.messages);

    const assistantMsg: Message = {
      role: 'assistant',
      content: response,
    };
    addMessage(conversation.id, assistantMsg);

    return {
      conversationId: conversation.id,
      response,
    };
  }

  async *processMessageStream(
    conversationId: string | undefined,
    userMessage: string,
    systemPrompt?: string
  ): AsyncGenerator<{ conversationId: string; chunk: string; done: boolean }, void, unknown> {
    const conversation = getOrCreateConversation(conversationId);

    if (systemPrompt && conversation.messages.length === 0) {
      const systemMessage: Message = {
        role: 'system',
        content: systemPrompt,
      };
      addMessage(conversation.id, systemMessage);
    }

    const userMsg: Message = {
      role: 'user',
      content: userMessage,
    };
    addMessage(conversation.id, userMsg);

    logger.info(`Processing streaming message for conversation ${conversation.id}`);

    let fullResponse = '';

    for await (const chunk of this.aiService.generateResponseStream(conversation.messages)) {
      fullResponse += chunk;
      yield {
        conversationId: conversation.id,
        chunk,
        done: false,
      };
    }

    const assistantMsg: Message = {
      role: 'assistant',
      content: fullResponse,
    };
    addMessage(conversation.id, assistantMsg);

    yield {
      conversationId: conversation.id,
      chunk: '',
      done: true,
    };
  }
}
