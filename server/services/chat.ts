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
  isSsml,
  removeMarkdownLinks,
} from "../utils/text";
import { getRecommendations } from "./recommendations";
import { isProductCardsEnabled } from "./settings";
import { resolveLanguage } from "../utils/language";

/** リクエスト ID を付けて応答イベントを送る関数 */
type EmitFn = (event: string, payload?: Record<string, unknown>) => void;

/**
 * クライアントが付けたリクエスト ID を検証する。
 * 任意の値をそのまま送り返すと巨大なペイロードの反射に使われうるので、
 * 短い文字列か有限の数値だけを受け付ける。
 */
export function resolveRequestId(value: unknown): string | number | undefined {
  if (typeof value === "string" && value.length > 0 && value.length <= 64) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}

export class ChatService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private chatHistory: any[] = [];
  // Monotonically increasing id of the latest input. A newer input supersedes
  // (cancels) any response still being generated on the same socket, so a user
  // interrupting the bot (barge-in) does not produce overlapping responses.
  private activeGeneration = 0;
  // 生成中の Gemini リクエストを打ち切るためのコントローラ。新しい入力や
  // 切断のときに abort し、不要になった生成の課金を止める。
  private activeAbort: AbortController | null = null;
  // 応答がまだ返っていない user ターン。割り込まれた場合は履歴から外す。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pendingUserTurn: any = null;

  /** 接続が切れたときに呼ぶ。生成中のリクエストを打ち切り、以後の送出を止める。 */
  dispose(): void {
    this.activeGeneration++;
    this.activeAbort?.abort();
    this.activeAbort = null;
  }

  async handleUserInput(
    socket: Socket,
    data: {
      text: string;
      isVoiceInput: boolean;
      language?: string;
      requestId?: unknown;
    },
  ): Promise<void> {
    // ペイロードを信用しない。null / undefined / プリミティブを分割代入すると
    // TypeError で Promise が reject し、呼び出し側が拾い損ねるとプロセスごと
    // 落ちる。クライアントは誰でも任意のペイロードを送れるので必ず検証する。
    if (data === null || typeof data !== "object") {
      socket.emit("error", { message: "Input is invalid" });
      return;
    }

    // クライアントが付けたリクエスト ID を応答イベントにそのまま付けて返す。
    // クライアントは自分が待っている ID と違うイベント（割り込まれた古い応答の
    // 取り残し）を捨てられる。ID が無い古いクライアントには従来どおりの形で返す。
    const requestId = resolveRequestId(data.requestId);
    const emit: EmitFn = (event, payload) => {
      if (requestId === undefined) {
        if (payload === undefined) socket.emit(event);
        else socket.emit(event, payload);
        return;
      }
      socket.emit(event, { ...(payload ?? {}), requestId });
    };

    const { text, isVoiceInput } = data;
    const language = resolveLanguage(data.language);

    if (!text || typeof text !== "string" || text.length > 1000) {
      emit("error", { message: "Input is invalid" });
      return;
    }

    // Claim this generation; if a newer input arrives it will bump the counter
    // and every guarded step below stops emitting for this (now stale) response.
    const generation = ++this.activeGeneration;
    const isSuperseded = (): boolean => generation !== this.activeGeneration;

    // 前の入力の生成がまだ続いていれば打ち切る（Gemini 側の課金も止まる）。
    this.activeAbort?.abort();
    const abortController = new AbortController();
    this.activeAbort = abortController;

    // 割り込まれた前の入力の user ターンは、応答が無いまま履歴に残ると
    // user が連続する不自然な履歴になるので外す。
    if (this.pendingUserTurn) {
      this.removeFromHistory(this.pendingUserTurn);
      this.pendingUserTurn = null;
    }

    // Gemini には「これまでの履歴」と「今回の発話」を分けて渡す。今回の発話を
    // 履歴に含めたまま sendMessageStream にも渡すと、同じ発話が 2 回送られて
    // 入力トークンの課金が倍になる。
    const priorHistory = [...this.chatHistory];

    const userTurn = { role: "user", parts: [{ text }] };
    this.chatHistory.push(userTurn);
    this.pendingUserTurn = userTurn;
    if (this.chatHistory.length > 20) {
      this.chatHistory.splice(0, 2);
    }

    const streamBuffer = new StreamBuffer();

    try {
      const allData = getAllSheetData();
      const stream = await generateResponseStream(
        text,
        allData,
        priorHistory,
        language,
        abortController.signal,
      );
      const ttsService = getTTSService();

      let fullResponseText = "";

      // Pipeline: audio emissions are chained to preserve sentence order while
      // TTS generation runs concurrently with LLM streaming.
      let audioEmitChain: Promise<void> = Promise.resolve();

      const enqueueSentence = (sentence: string): void => {
        if (isSuperseded()) return;
        const uiText = stripTags(sentence);

        if (isVoiceInput) {
          emit("audio-chunk", { type: "text", content: uiText });

          // Start TTS immediately (concurrent with LLM streaming and other sentences)
          const streamPromise = this.startEagerTTSStream(sentence, ttsService, language);

          // Chain: emit this sentence's audio only after the previous one finishes
          audioEmitChain = audioEmitChain.then(() => {
            if (isSuperseded()) {
              // Superseded by a newer input: discard the buffered audio without
              // emitting it. Resuming with no data listener drains and drops it.
              //
              // 'error' リスナーを必ず先に付ける。ElevenLabs のストリームは
              // resume 後に下流の fetch が失敗すると 'error' を emit し、
              // リスナーが無い Readable の 'error' は uncaughtException になって
              // プロセスを落とす。
              return streamPromise
                .then((s) => {
                  if (!s) return;
                  s.on("error", (err: Error) => {
                    console.error("[TTS] Discarded stream error:", err.message);
                  });
                  s.resume();
                })
                .catch((err: unknown) => {
                  const message =
                    err instanceof Error ? err.message : String(err);
                  console.error("[TTS] Failed to discard stream:", message);
                });
            }
            return this.drainStreamToSocket(emit, streamPromise);
          });
        } else {
          emit("text-chunk", { content: uiText });
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
      if (this.pendingUserTurn === userTurn) this.pendingUserTurn = null;
      if (this.activeAbort === abortController) this.activeAbort = null;

      // Card display can be turned off from the spreadsheet's settings sheet.
      if (isProductCardsEnabled()) {
        // Pass the assistant's answer so cards track what was actually
        // recommended, not just keyword overlap with the user's message.
        const recommendations = getRecommendations(text, allData, {
          responseText: fullResponseText,
        });
        if (recommendations.length > 0) {
          emit("recommendation", { products: recommendations });
        }
      }

      emit("response-complete");
    } catch (error: unknown) {
      // 割り込み・切断で自分から abort した場合は想定内なのでログを出さない
      if (isSuperseded()) return;

      const message = error instanceof Error ? error.message : String(error);
      console.error("Error processing input:", message);

      // 応答できなかった user ターンを履歴から外す。残すと次の入力で
      // user が連続した履歴になる。
      this.removeFromHistory(userTurn);
      if (this.pendingUserTurn === userTurn) this.pendingUserTurn = null;
      if (this.activeAbort === abortController) this.activeAbort = null;

      emit("error", { message: "Internal server error occurred." });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private removeFromHistory(turn: any): void {
    const index = this.chatHistory.indexOf(turn);
    if (index !== -1) this.chatHistory.splice(index, 1);
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
    emit: EmitFn,
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
            emit("audio-chunk", { type: "audio", content: full });
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
    // すでに SSML として組み立てられた文だけを素通しする。`hasTags` は
    // `<[^>]*>` に一致するだけなので、LLM が出力した「A<B>C」や「<br>」でも真に
    // なり、無エスケープのまま <speak> に包まれて TTS の SSML パースエラーを招く
    // （その文だけ音声が無言になる）。先頭が <speak> の場合に限定し、それ以外は
    // 必ずエスケープ経路へ送る。
    if (isSsml(sentence) && hasTags(sentence)) {
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
