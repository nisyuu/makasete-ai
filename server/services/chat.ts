import { Socket } from "socket.io";
import { getAllSheetData } from "./sheets";
import { generateResponseStream } from "./gemini";
import { getTTSService } from "./tts/factory";
import { TTSService } from "./tts/types";
import { StreamBuffer } from "../utils/streamBuffer";
import {
  stripTags,
  cleanupForTTS,
  hasTags,
  removeMarkdownLinks,
} from "../utils/text";

export class ChatService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private chatHistory: any[] = [];

  async handleUserInput(
    socket: Socket,
    data: { text: string; isVoiceInput: boolean },
  ): Promise<void> {
    const { text, isVoiceInput } = data;

    if (!text || typeof text !== "string" || text.length > 1000) {
      socket.emit("error", { message: "Input is invalid" });
      return;
    }

    this.chatHistory.push({ role: "user", parts: [{ text }] });
    if (this.chatHistory.length > 20) {
      this.chatHistory.splice(0, 2);
    }

    const streamBuffer = new StreamBuffer();

    try {
      const allData = getAllSheetData();
      const stream = await generateResponseStream(text, allData, this.chatHistory);
      const ttsService = getTTSService();

      let fullResponseText = "";

      for await (const chunk of stream) {
        const chunkText = chunk.text();
        fullResponseText += chunkText;

        const sentences = streamBuffer.add(chunkText);
        for (const sentence of sentences) {
          await this.processSentence(socket, sentence, isVoiceInput, ttsService);
        }
      }

      const remaining = streamBuffer.flush();
      if (remaining) {
        await this.processSentence(socket, remaining, isVoiceInput, ttsService);
      }

      this.chatHistory.push({
        role: "model",
        parts: [{ text: fullResponseText }],
      });

      socket.emit("response-complete");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error processing input:", message);
      socket.emit("error", { message: "Internal server error occurred." });
    }
  }

  private async processSentence(
    socket: Socket,
    sentence: string,
    isVoiceInput: boolean,
    ttsService: TTSService,
  ): Promise<void> {
    const uiText = stripTags(sentence);

    if (isVoiceInput) {
      socket.emit("audio-chunk", { type: "text", content: uiText });

      try {
        let ttsInput: string;
        if (hasTags(sentence)) {
          const innerText = sentence.replace(/<\/?speak>/g, "").trim();
          ttsInput = `<speak>${removeMarkdownLinks(innerText)}</speak>`;
        } else {
          ttsInput = cleanupForTTS(sentence);
        }

        if (!ttsInput.trim() || !stripTags(ttsInput).trim()) return;

        const audioStream: NodeJS.ReadableStream =
          await ttsService.generateSpeechStream(ttsInput);

        const chunks: Buffer[] = [];
        audioStream.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        await new Promise((resolve, reject) => {
          audioStream.on("end", () => {
            const fullBuffer = Buffer.concat(chunks);
            socket.emit("audio-chunk", { type: "audio", content: fullBuffer });
            setTimeout(resolve, 50);
          });
          audioStream.on("error", (err) => {
            console.error("[TTS] Stream error:", err);
            reject(err);
          });
        });
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("TTS Error:", message);
      }
    } else {
      socket.emit("text-chunk", { content: uiText });
    }
  }
}
