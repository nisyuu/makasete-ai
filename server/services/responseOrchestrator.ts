import { ChatService, ChatMessage } from "./chatService";
import { TTSService } from "./ttsService";
import { stripTags } from "../utils/text";

export interface ProcessCallbacks {
  onVoiceChunk?: (uiText: string, audioBuffer: Buffer) => Promise<void>;
  onTextChunk?: (uiText: string) => void;
  onComplete?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Orchestrates chat response generation and TTS synthesis.
 * Protocol-agnostic: uses callbacks instead of Socket.io directly.
 */
export class ResponseOrchestrator {
  constructor(
    private readonly chatService: ChatService,
    private readonly ttsService: TTSService,
  ) {}

  async processMessage(
    data: { text: string; isVoiceInput: boolean },
    history: ChatMessage[],
    callbacks: ProcessCallbacks,
  ): Promise<void> {
    try {
      await this.chatService.streamResponse(data.text, history, {
        onSentence: async (sentence: string) => {
          await this.processSentence(sentence, data.isVoiceInput, callbacks);
        },
        onComplete: (fullText: string) => {
          history.push({ role: "model", parts: [{ text: fullText }] });
          callbacks.onComplete?.();
        },
      });
    } catch (error) {
      callbacks.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private async processSentence(
    sentence: string,
    isVoiceInput: boolean,
    callbacks: ProcessCallbacks,
  ): Promise<void> {
    if (isVoiceInput) {
      const result = await this.ttsService.synthesize(sentence);
      if (!result) return;

      if (callbacks.onVoiceChunk) {
        await callbacks.onVoiceChunk(result.uiText, result.audioBuffer);
      }
    } else {
      callbacks.onTextChunk?.(stripTags(sentence));
    }
  }
}
