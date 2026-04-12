import { Message, AIServiceConfig } from '../types';
import { logger } from '../utils/logger';

export class AIService {
  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(config: AIServiceConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-3.5-turbo';
    this.maxTokens = config.maxTokens || 1024;
    this.temperature = config.temperature || 0.7;
  }

  async generateResponse(messages: Message[]): Promise<string> {
    logger.info(`Generating response with model ${this.model}`);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: this.maxTokens,
          temperature: this.temperature,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI API error: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      const content = data.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in AI response');
      }

      return content;
    } catch (error) {
      logger.error('Error generating AI response', error);
      throw error;
    }
  }

  async *generateResponseStream(
    messages: Message[]
  ): AsyncGenerator<string, void, unknown> {
    logger.info(`Generating streaming response with model ${this.model}`);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: this.maxTokens,
          temperature: this.temperature,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI API error: ${response.status} ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter((line) => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;

            try {
              const parsed = JSON.parse(data) as {
                choices: Array<{ delta: { content?: string } }>;
              };
              const content = parsed.choices[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error generating streaming AI response', error);
      throw error;
    }
  }
}
