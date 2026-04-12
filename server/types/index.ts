export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Conversation {
  id: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatRequest {
  conversationId?: string;
  message: string;
  systemPrompt?: string;
}

export interface ChatResponse {
  conversationId: string;
  message: string;
  role: 'assistant';
}

export interface StreamChunk {
  conversationId: string;
  chunk: string;
  done: boolean;
}

export interface AIServiceConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}
