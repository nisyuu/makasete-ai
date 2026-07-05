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
import { getRecommendations } from "./recommendations";
import { isProductCardsEnabled } from "./settings";

export class ChatService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private chatHistory: any[] = [];
  // Monotonically increasing id of the latest input. A newer input supersedes
  // (cancels) any response still being generated on the same socket, so a user
  // interrupting the bot (barge-in) does not produce overlapping responses.
  private activeGeneration = 0;

  async handleUserInput(
    socket: Socket,
    data: { text: string; isVoiceInput: boolean; language?: string },
  ): Promise<void> {
    const { text, isVoiceInput, language = "ja" } = data;

    if (!text || typeof text !== "string" || text.length > 1000) {
      socket.emit("error", { message: "Input is invalid" });
      return;
    }

    // Claim this generation; if a newer input arrives it will bump the counter
    // and every guarded step below stops emitting for this (now stale) response.
    const generation = ++this.activeGeneration;
    const isSuperseded = (): boolean => generation !== this.activeGeneration;

    this.chatHistory.push({ role: "user", parts: [{ text }] });
    if (this.chatHistory.length > 20) {
      this.chatHistory.splice(0, 2);
    }

    const streamBuffer = new StreamBuffer();

    try {
      const allData = getAllSheetData();
      const stream = await generateResponseStream(text, allData, this.chatHistory, language);
      const ttsService = getTTSService();

      let fullResponseText = "";

      // Pipeline: audio emissions are chained to preserve sentence order while
      // TTS generation runs concurrently with LLM streaming.
      let audioEmitChain: Promise<void> = Promise.resolve();

      const enqueueSentence = (sentence: string): void => {
        if (isSuperseded()) return;
        const uiText = stripTags(sentence);

        if (isVoiceInput) {
          socket.emit("audio-chunk", { type: "text", content: uiText });

          // Start TTS immediately (concurrent with LLM streaming and other sentences)
          const streamPromise = this.startEagerTTSStream(sentence, ttsService, language);

          // Chain: emit this sentence's audio only after the previous one finishes
          audioEmitChain = audioEmitChain.then(() => {
            if (isSuperseded()) {
              // Superseded by a newer input: discard the buffered audio without
              // emitting it. Resuming with no data listener drains and drops it.
              return streamPromise.then((s) => {
                s?.resume();
              });
            }
            return this.drainStreamToSocket(socket, streamPromise);
          });
        } else {
          socket.emit("text-chunk", { content: uiText });
        }
      };

      for await (const chunk of stream) {
        if (isSuperseded()) break;
        const chunkText = chunk.text();
        fullResponseText += chunkText;

        const sentences = streamBuffer.add(chunkText);
        for (const sentence of sentences) {
          enqueueSentence(sentence);
        }
      }

      if (!isSuperseded()) {
        const remaining = streamBuffer.flush();
        if (remaining) {
          enqueueSentence(remaining);
        }
      }

      // Wait for all audio to finish before signaling completion
      await audioEmitChain;

      // A newer input arrived while generating: drop this stale response entirely
      // (no history push, recommendations or completion) to keep the conversation
      // order intact and avoid emitting events that overlap the newer response.
      if (isSuperseded()) return;

      this.chatHistory.push({
        role: "model",
        parts: [{ text: fullResponseText }],
      });

      // Card display can be turned off from the spreadsheet's settings sheet.
      if (isProductCardsEnabled()) {
        // Pass the assistant's answer so cards track what was actually
        // recommended, not just keyword overlap with the user's message.
        const recommendations = getRecommendations(text, allData, {
          responseText: fullResponseText,
        });
        if (recommendations.length > 0) {
          socket.emit("recommendation", { products: recommendations });
        }
      }

      socket.emit("response-complete");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Error processing input:", message);
      // Only surface the error for the response the client is still expecting.
      if (!isSuperseded()) {
        socket.emit("error", { message: "Internal server error occurred." });
      }
    }
  }

  // Starts TTS generation eagerly (without awaiting the caller) and returns a
  // paused stream. The stream buffers internally until drainStreamToSocket resumes it.
  private async startEagerTTSStream(
    sentence: string,
    ttsService: TTSService,
    language: string,
  ): Promise<NodeJS.ReadableStream | null> {
    const ttsInput = this.prepareTTSInput(sentence, ttsService.getName());
    if (!ttsInput) return null;

    try {
      const audioStream = await ttsService.generateSpeechStream(ttsInput, language);
      audioStream.pause(); // Buffer internally; drainStreamToSocket will resume
      return audioStream;
    } catch (e: unknown) {
      console.error("[TTS] Failed to start stream:", e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  // Resumes a paused audio stream, buffers it in full, and forwards the whole
  // sentence's audio to the socket as a single "audio-chunk".
  //
  // The audio is MP3, which cannot be split at arbitrary byte boundaries: MP3's
  // bit reservoir stores a frame's high-frequency data in preceding frames, so
  // decoding a mid-stream byte slice on its own loses those highs and sounds
  // muffled (plus clicks/gaps at frame-desynced boundaries). The client decodes
  // each "audio-chunk" as a self-contained MP3 via decodeAudioData, so we must
  // send one complete MP3 per sentence rather than partial slices.
  private async drainStreamToSocket(
    socket: Socket,
    streamPromise: Promise<NodeJS.ReadableStream | null>,
  ): Promise<void> {
    const audioStream = await streamPromise;
    if (!audioStream) return;

    await new Promise<void>((resolve) => {
      const chunks: Buffer[] = [];

      audioStream.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      audioStream.on("end", () => {
        if (chunks.length > 0) {
          const full = Buffer.concat(chunks);
          if (full.length > 0) {
            socket.emit("audio-chunk", { type: "audio", content: full });
          }
        }
        resolve();
      });

      audioStream.on("error", (err) => {
        console.error("[TTS] Stream error:", err);
        resolve(); // Continue to next sentence rather than aborting the chain
      });

      audioStream.resume();
    });
  }

  // Prepares the TTS input string, applying SSML pause tuning for Google TTS.
  private prepareTTSInput(sentence: string, ttsProviderName: string): string | null {
    if (hasTags(sentence)) {
      const innerText = sentence.replace(/<\/?speak>/g, "").trim();
      const ssmlContent = removeMarkdownLinks(innerText);
      if (!ssmlContent.trim() || !ssmlContent.replace(/<[^>]*>/g, "").trim()) return null;
      return `<speak>${ssmlContent}</speak>`;
    }

    const cleanedText = cleanupForTTS(sentence);
    if (!cleanedText.trim()) return null;

    // Google TTS supports SSML: insert break tags for natural Japanese prosody
    if (ttsProviderName === "gemini-tts") {
      return this.wrapInSSMLWithPauses(cleanedText);
    }

    return cleanedText;
  }

  // Wraps plain text in SSML and inserts pause breaks after Japanese/English punctuation.
  private wrapInSSMLWithPauses(text: string): string {
    // cleanupForTTS already escapes &; also escape < and > for valid XML
    const safe = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<speak>${safe
      .replace(/。/g, '。<break time="300ms"/>')
      .replace(/、/g, '、<break time="150ms"/>')
      .replace(/！/g, '！<break time="300ms"/>')
      .replace(/？/g, '？<break time="300ms"/>')
      .replace(/…/g, '…<break time="500ms"/>')
    }</speak>`;
  }
}
