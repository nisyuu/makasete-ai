import { getTTSService } from "./tts/factory";
import { TTSService as ITTSService } from "./tts/types";
import {
  stripTags,
  cleanupForTTS,
  hasTags,
  removeMarkdownLinks,
} from "../utils/text";

export interface TTSResult {
  /** UI-safe plain text (tags stripped) */
  uiText: string;
  /** Raw audio buffer from TTS synthesis */
  audioBuffer: Buffer;
}

/**
 * Handles text-to-speech synthesis.
 * Wraps the existing TTS factory/interface and encapsulates
 * SSML preparation and audio buffering logic.
 * Protocol-agnostic: no Socket.io dependency.
 */
export class TTSService {
  private readonly service: ITTSService;

  constructor() {
    this.service = getTTSService();
  }

  /**
   * Converts a sentence (plain text or SSML) into a TTSResult containing
   * the UI-safe text and the synthesised audio buffer.
   *
   * Returns `null` when the sentence contains no speakable content.
   *
   * @param sentence - Raw sentence text, possibly containing SSML tags
   */
  async synthesize(sentence: string): Promise<TTSResult | null> {
    const uiText = stripTags(sentence);

    // Prepare TTS input
    let ttsInput: string;
    if (hasTags(sentence)) {
      const innerText = sentence.replace(/<\/?speak>/g, "").trim();
      ttsInput = `<speak>${removeMarkdownLinks(innerText)}</speak>`;
    } else {
      ttsInput = cleanupForTTS(sentence);
    }

    // Skip sentences with no speakable content
    if (!ttsInput.trim() || !stripTags(ttsInput).trim()) {
      return null;
    }

    const audioBuffer = await this.streamToBuffer(
      await this.service.generateSpeechStream(ttsInput),
    );

    return { uiText, audioBuffer };
  }

  /**
   * Collects all chunks from a readable stream into a single Buffer.
   */
  private streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];

      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", (err) => {
        console.error("[TTS] Stream error:", err);
        reject(err);
      });
    });
  }
}
