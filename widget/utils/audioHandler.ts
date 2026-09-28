import type { PcmFormat } from "../types";
import { createPcmResampler } from "./pcmResampler";
import { findCutPoint } from "./pcmSegmenter";

// AudioContext.createBuffer が受け付けるサンプルレートの範囲
const MIN_SAMPLE_RATE = 3000;
const MAX_SAMPLE_RATE = 768000;

// PCM を区間にまとめるときの長さ（秒）。最初は短くして鳴り始めを遅らせず、以後は長くして継ぎ目を減らす。
const PCM_FIRST_SEGMENT_SEC = 0.3;
const PCM_MAX_SEGMENT_SEC = 2;
// 予約済みの音の残りがこれより少なければ、目安の長さに届かなくても溜まった分を予約する
const PCM_LOW_WATER_SEC = 0.25;
// この時間、次の断片が届かなければ溜まっている分を全部鳴らす
const PCM_FLUSH_DELAY_MS = 120;
// 継ぎ目を置く「静かな所」の判定。10ms の窓のピークが -34dBFS 未満なら発話の合間とみなす。
const PCM_QUIET_WINDOW_SEC = 0.01;
const PCM_QUIET_PEAK = 0.02;

interface BufferData {
  type: "Buffer";
  data: number[];
}

export interface AudioHandlerOptions {
  /** 認識途中のテキスト（プレビュー用）。送信はしない。 */
  onTranscript: (text: string) => void;
  /** 録音終了時に確定したテキストを渡す。空文字なら確定結果なし。 */
  onRecordingEnd: (finalText: string) => void;
  onError?: (error: Error) => void;
  language?: string;
}

export interface AudioHandler {
  /**
   * 音声チャンクを再生する。pcm が無ければ MP3 などの1応答分のファイルとしてキューに積み、
   * pcm があればヘッダ無しの PCM 断片として溜め、区間にまとめて前の区間の直後に予約する。
   */
  handleAudioChunk: (content: unknown, pcm?: PcmFormat) => void;
  /** AudioContextを初期化する（ユーザー操作後に呼ぶ） */
  initAudioContext: () => void;
  /** AudioContextをresumeする */
  resumeAudioContext: () => Promise<void>;
  /**
   * 再生中の音声を停止してキューをクリアし、次の beginResponse まで届く音声を捨てる。
   * 読み上げ OFF・ウィンドウを閉じる・録音開始など、今の応答をもう聞かせないときに使う。
   */
  resetAudioState: () => void;
  /** 前の応答の音声を停止し、新しい応答の音声を受け付け始める。質問を送るときに使う。 */
  beginResponse: () => void;
  /** 音声認識を開始/停止トグルする。トグル後に録音中なら true を返す。 */
  toggleRecording: () => boolean;
  /** 音声認識が利用可能かどうか */
  isSpeechRecognitionSupported: () => boolean;
  /** リソースを解放する */
  cleanup: () => void;
}

/**
 * Web Audio API・TTS再生キュー・音声認識を管理するハンドラーを初期化する
 */
export function initAudioHandler(options: AudioHandlerOptions): AudioHandler {
  const { onTranscript, onRecordingEnd, onError, language = "ja" } = options;

  // Web Audio API
  let audioContext: AudioContext | null = null;
  let currentSource: AudioBufferSourceNode | null = null;
  let gainNode: GainNode | null = null;

  // 再生キュー
  const audioQueue: ArrayBuffer[] = [];
  let isPlaying = false;
  // resetAudioState のたびに進める世代番号。decodeAudioData の完了を待って
  // いる間にリセットされた場合、古い世代の音声を再生しないために使う。
  let playbackGeneration = 0;
  // resetAudioState の後、同じ応答の残りの音声を鳴らさないためのフラグ。
  // PCM は数十ミリ秒の断片で届くので、止めても直後の断片で続きが鳴ってしまう。
  let isMuted = false;

  // PCM の再生予約。断片は数十ミリ秒と短く、そのまま1つずつ鳴らすと iOS Safari では継ぎ目ごとにプツッと鳴る。
  // 断片を区間にまとめ、AudioContext の時計で前の区間の終わる時刻に次を予約して隙間なく並べる。
  const pcmSources = new Set<AudioBufferSourceNode>();
  let pcmNextStartTime = 0;
  // 出力のサンプルレートへの変換を断片の境目をまたいで続けるための状態
  const pcmResampler = createPcmResampler();
  // 区間にまとめる前の PCM（出力のサンプルレートに変換済み）
  const pcmPending: Float32Array[] = [];
  let pcmPendingLength = 0;
  let pcmPendingRate = 0;
  let pcmFlushTimer: ReturnType<typeof setTimeout> | null = null;

  // 音声認識
  let recognition: SpeechRecognition | null = null;
  let isRecording = false;
  // 録音セッション中に確定した（isFinal）テキストを蓄積する
  let finalTranscript = "";

  // --- AudioContext ---

  function initAudioContext(): void {
    if (audioContext) return;
    try {
      // @ts-expect-error: webkitAudioContext は古いブラウザ向け
      const ContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new ContextClass();
      gainNode = audioContext.createGain();
      gainNode.connect(audioContext.destination);
    } catch (e) {
      console.error("[MakaseteAI] Failed to initialize AudioContext:", e);
    }
  }

  async function resumeAudioContext(): Promise<void> {
    initAudioContext();
    // iOS Safari は着信や Siri の後に "interrupted" という状態になる。
    // "suspended" だけを見ていると復帰できず、以後の読み上げが無音になる。
    // "running" でも "closed" でもなければ resume する。
    const state = audioContext?.state as string | undefined;
    if (audioContext && state !== "running" && state !== "closed") {
      await audioContext.resume();
    }
  }

  // --- 音声再生キュー ---

  async function playNextInQueue(): Promise<void> {
    if (isPlaying || audioQueue.length === 0) return;
    // 録音中はボットの発話を再生しない（マイクが自分の音声を拾うのを防ぐ）
    if (isRecording) return;
    if (!audioContext) initAudioContext();
    if (!audioContext) return;

    isPlaying = true;
    const rawData = audioQueue.shift();
    const generation = playbackGeneration;

    if (rawData) {
      try {
        // decodeAudioData はバッファを消費するのでコピーを渡す
        const audioBuffer = await audioContext.decodeAudioData(
          rawData.slice(0),
        );

        // decode の待機中に resetAudioState された（新しいメッセージの送信、
        // 読み上げ OFF、ウィンドウを閉じた）場合、この音声は古いので再生しない。
        // isPlaying は新しい世代が使っているかもしれないので触らない。
        if (generation !== playbackGeneration) {
          return;
        }

        // decode の待機中に録音が開始された場合は再生を中止する
        if (isRecording) {
          isPlaying = false;
          return;
        }

        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        if (gainNode) source.connect(gainNode);

        currentSource = source;

        source.onended = () => {
          if (currentSource === source) {
            currentSource = null;
            isPlaying = false;
            playNextInQueue();
          }
        };

        source.start(0);
      } catch (e) {
        console.error("[MakaseteAI] Audio decode/play failed:", e);
        // リセット後なら新しい世代の再生状態を壊さない
        if (generation !== playbackGeneration) return;
        isPlaying = false;
        playNextInQueue();
      }
    } else {
      isPlaying = false;
    }
  }

  function schedulePcmChunk(rawData: ArrayBuffer, sampleRate: number): void {
    if (!audioContext) initAudioContext();
    if (!audioContext) return;

    const sampleCount = Math.floor(rawData.byteLength / 2);
    if (sampleCount === 0) return;

    // 変換後の長さは入力のサンプルレートに比例するので、Web Audio が扱える範囲外の値は変換する前に弾く
    if (sampleRate < MIN_SAMPLE_RATE || sampleRate > MAX_SAMPLE_RATE) {
      console.error("[MakaseteAI] Unsupported PCM sample rate:", sampleRate);
      return;
    }

    const samples = new Float32Array(sampleCount);
    const view = new DataView(rawData);
    for (let i = 0; i < sampleCount; i++) {
      samples[i] = view.getInt16(i * 2, true) / 32768;
    }

    const outRate = audioContext.sampleRate;
    const resampled = pcmResampler.process(samples, sampleRate, outRate);
    if (resampled.length === 0) return;

    if (outRate !== pcmPendingRate) flushPendingPcm();
    pcmPendingRate = outRate;
    pcmPending.push(resampled);
    pcmPendingLength += resampled.length;
    schedulePendingPcm(false);

    // 断片が途切れたら（応答の終わりなど）、溜まっている分を全部鳴らす
    if (pcmFlushTimer !== null) clearTimeout(pcmFlushTimer);
    pcmFlushTimer = setTimeout(flushPendingPcm, PCM_FLUSH_DELAY_MS);
  }

  function flushPendingPcm(): void {
    if (pcmFlushTimer !== null) {
      clearTimeout(pcmFlushTimer);
      pcmFlushTimer = null;
    }
    schedulePendingPcm(true);
  }

  // 溜めた PCM を区間にまとめて予約する。区間が長いほど継ぎ目が減る。
  // ただし、予約済みの音が鳴り終わるまでに次の区間を予約しないと途切れるので、残りが少なければ溜まった分で区切る。
  function schedulePendingPcm(force: boolean): void {
    if (!audioContext || pcmPendingLength === 0) return;
    const rate = pcmPendingRate;
    const ahead = Math.max(0, pcmNextStartTime - audioContext.currentTime);

    let from: number;
    if (force) {
      from = pcmPendingLength;
    } else if (ahead === 0) {
      // 応答の始まり（または途切れた後）。最初の区間は短めにして、鳴り始めを遅らせない。
      if (pcmPendingLength < PCM_FIRST_SEGMENT_SEC * rate) return;
      from = Math.floor((PCM_FIRST_SEGMENT_SEC / 2) * rate);
    } else {
      // 次の区間は、予約済みの音の残りと同じくらいの長さを目安にする（鳴り終わるまでに次が溜まる）
      const target = Math.min(PCM_MAX_SEGMENT_SEC, Math.max(PCM_FIRST_SEGMENT_SEC, ahead)) * rate;
      if (pcmPendingLength < target && ahead > PCM_LOW_WATER_SEC) return;
      from = Math.floor(Math.min(target, pcmPendingLength) / 2);
    }

    const pending = concatFloat32(pcmPending, pcmPendingLength);
    const cut = force
      ? pending.length
      : findCutPoint(pending, from, Math.max(1, Math.round(PCM_QUIET_WINDOW_SEC * rate)), PCM_QUIET_PEAK);
    const segment = pending.subarray(0, cut);
    const rest = pending.subarray(cut);
    pcmPending.length = 0;
    pcmPendingLength = rest.length;
    if (rest.length > 0) pcmPending.push(rest);
    if (segment.length > 0) startPcmSegment(segment, rate);
  }

  function startPcmSegment(segment: Float32Array, rate: number): void {
    if (!audioContext) return;
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = audioContext.createBuffer(1, segment.length, rate);
    } catch (e) {
      console.error("[MakaseteAI] Failed to create PCM buffer:", e);
      return;
    }
    audioBuffer.getChannelData(0).set(segment);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    if (gainNode) source.connect(gainNode);
    source.onended = () => {
      pcmSources.delete(source);
    };

    // 前の区間がもう鳴り終わっていれば（応答の始まりなど）すぐに鳴らす。
    // 開始時刻を出力のサンプル境界にそろえ、以後の区間も整数サンプル分ずつ並べて継ぎ目に隙間や重なりを作らない。
    const startAt =
      pcmNextStartTime > audioContext.currentTime
        ? pcmNextStartTime
        : Math.ceil(audioContext.currentTime * rate) / rate;
    source.start(startAt);
    pcmNextStartTime = startAt + segment.length / rate;
    pcmSources.add(source);
  }

  function concatFloat32(parts: Float32Array[], length: number): Float32Array {
    if (parts.length === 1) return parts[0];
    const out = new Float32Array(length);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }

  function handleAudioChunk(content: unknown, pcm?: PcmFormat): void {
    // 録音中はボットの発話を再生しない（マイクが自分の音声を拾うのを防ぐ）
    if (isRecording || isMuted) return;

    let rawData: ArrayBuffer;

    if (content instanceof ArrayBuffer) {
      rawData = content;
    } else if (
      content &&
      typeof content === "object" &&
      "data" in content &&
      (content as BufferData).type === "Buffer"
    ) {
      rawData = new Uint8Array((content as BufferData).data).buffer;
    } else if (content instanceof Uint8Array) {
      // .buffer をそのまま渡すと、大きなバッファの一部を指すビューだった場合に
      // 前後の無関係なバイトまで decode してしまい失敗する。
      rawData = content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength,
      ) as ArrayBuffer;
    } else {
      console.warn("[MakaseteAI] Unexpected audio format");
      return;
    }

    if (pcm) {
      schedulePcmChunk(rawData, pcm.sampleRate);
      return;
    }

    audioQueue.push(rawData);
    playNextInQueue();
  }

  function resetAudioState(): void {
    stopPlayback();
    isMuted = true;
  }

  function beginResponse(): void {
    stopPlayback();
    isMuted = false;
  }

  function stopPlayback(): void {
    // decode 待ちの音声を無効化する
    playbackGeneration += 1;
    if (currentSource) {
      try {
        currentSource.stop();
      } catch {
        // すでに停止済みの場合は無視
      }
      currentSource = null;
    }
    isPlaying = false;
    audioQueue.length = 0;
    for (const source of pcmSources) {
      try {
        source.stop();
      } catch {
        // すでに停止済みの場合は無視
      }
    }
    pcmSources.clear();
    pcmNextStartTime = 0;
    pcmResampler.reset();
    pcmPending.length = 0;
    pcmPendingLength = 0;
    if (pcmFlushTimer !== null) {
      clearTimeout(pcmFlushTimer);
      pcmFlushTimer = null;
    }
  }

  // --- 音声認識 ---

  function initSpeechRecognition(): void {
    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      console.warn("[MakaseteAI] Speech Recognition not supported");
      return;
    }

    const rec = new SpeechRecognitionAPI();
    recognition = rec;
    const recognitionLang = language === "en" ? "en-US" : "ja-JP";
    // 日本語は単語をスペースで区切らないため、認識エンジンがフレーズ間に
    // 挿入するスペースを除去して文章を繋げる。英語はスペースが語の区切り
    // として必要なのでそのまま残す。
    const stripSpaces = recognitionLang === "ja-JP";
    const normalizeTranscript = (text: string): string =>
      stripSpaces ? text.replace(/\s+/g, "") : text;
    rec.lang = recognitionLang;
    rec.continuous = false;
    // 認識途中の結果も受け取り、入力欄にプレビュー表示する。
    // ただし送信は発話が確定して録音が終了する onend のタイミングで一度だけ行う。
    rec.interimResults = true;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      // 確定済みテキストは finalTranscript に蓄積し、未確定分のみ interim にまとめる。
      // event.resultIndex 以降だけを走査することで、確定済み結果の二重加算を防ぐ。
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = normalizeTranscript(result[0].transcript);
        if (result.isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }
      // プレビュー表示のみ（この時点では送信しない）
      onTranscript(finalTranscript + interim);
    };

    rec.onend = () => {
      isRecording = false;
      // 発話が確定したテキストを一度だけ確定通知する
      const text = finalTranscript.trim();
      finalTranscript = "";
      onRecordingEnd(text);
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      isRecording = false;
      finalTranscript = "";
      onRecordingEnd("");
      onError?.(new Error(event.error));
    };
  }

  function toggleRecording(): boolean {
    if (!recognition) return false;

    if (isRecording) {
      // 停止をリクエストする。isRecording は onend で false になる。
      recognition.stop();
      return false;
    }

    // 録音開始時に再生中のボット音声を止める。
    // これにより「発話中にマイクを押すと発話が止まり、
    // ボットの音声がテキスト化されて入力欄に入る」問題を防ぐ。
    resetAudioState();
    finalTranscript = "";
    try {
      recognition.start();
    } catch (e) {
      // すでに開始済み等で start() が失敗した場合は録音状態にしない。
      // （ボタン表示と実状態がずれるのを防ぐ）
      isRecording = false;
      onError?.(e instanceof Error ? e : new Error(String(e)));
      return false;
    }
    isRecording = true;
    return true;
  }

  function isSpeechRecognitionSupported(): boolean {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function cleanup(): void {
    resetAudioState();
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        // 無視
      }
      recognition = null;
    }
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
  }

  // 音声認識を初期化
  initSpeechRecognition();

  return {
    handleAudioChunk,
    initAudioContext,
    resumeAudioContext,
    resetAudioState,
    beginResponse,
    toggleRecording,
    isSpeechRecognitionSupported,
    cleanup,
  };
}
