import { generateResponseStream } from "./gemini";
import { getAllSheetData } from "./sheets";
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
  async streamResponse(
    userMessage: string,
    history: ChatMessage[],
    callbacks: ChatStreamCallbacks,
  ): Promise<void> {
    const streamBuffer = new StreamBuffer();
    const allData = getAllSheetData();
    const stream = await generateResponseStream(userMessage, allData, history);

    let fullResponseText = "";

    for await (const chunk of stream) {
      const chunkText = chunk.text();
      fullResponseText += chunkText;

      const sentences = streamBuffer.add(chunkText);
      for (const sentence of sentences) {
        await callbacks.onSentence(sentence);
      }
    }

    const remaining = streamBuffer.flush();
    if (remaining) {
      await callbacks.onSentence(remaining);
    }

    callbacks.onComplete(fullResponseText);
  }
}
