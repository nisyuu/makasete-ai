import { generateResponseStream } from "./gemini";
import { StreamBuffer } from "../utils/streamBuffer";

export interface ChatMessage {
  role: "user" | "model";
  parts: [{ text: string }];
}

export interface ChatStreamCallbacks {
  onSentence: (sentence: string) => Promise<void>;
  onComplete: (fullText: string) => void;
}

/**
 * Manages AI chat response generation.
 * Protocol-agnostic: no Socket.io dependency.
 */
export class ChatService {
  /**
   * Streams a response for the given user message, invoking callbacks
   * for each completed sentence and once for the full response.
   *
   * @param userMessage - The user's input text
   * @param history     - The current conversation history (mutated in place)
   * @param callbacks   - Sentence and completion callbacks
   */
  async streamResponse(
    userMessage: string,
    history: ChatMessage[],
    callbacks: ChatStreamCallbacks,
  ): Promise<void> {
    const streamBuffer = new StreamBuffer();
    const stream = await generateResponseStream(userMessage, history);

    let fullResponseText = "";

    for await (const chunk of stream) {
      const chunkText = chunk.text();
      fullResponseText += chunkText;

      const sentences = streamBuffer.add(chunkText);
      for (const sentence of sentences) {
        await callbacks.onSentence(sentence);
      }
    }

    // Flush any remaining buffered text
    const remaining = streamBuffer.flush();
    if (remaining) {
      await callbacks.onSentence(remaining);
    }

    callbacks.onComplete(fullResponseText);
  }
}
