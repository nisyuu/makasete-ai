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
  /** 音声チャンクをキューに追加して再生する */
  handleAudioChunk: (content: unknown) => void;
  /** AudioContextを初期化する（ユーザー操作後に呼ぶ） */
  initAudioContext: () => void;
  /** AudioContextをresumeする */
  resumeAudioContext: () => Promise<void>;
  /** 再生中の音声を停止してキューをクリアする */
  resetAudioState: () => void;
  /** 音声認識を開始/停止トグルする */
  toggleRecording: () => void;
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
    if (audioContext && audioContext.state === "suspended") {
      await audioContext.resume();
    }
  }

  // --- 音声再生キュー ---

  async function playNextInQueue(): Promise<void> {
    if (isPlaying || audioQueue.length === 0) return;
    if (!audioContext) initAudioContext();
    if (!audioContext) return;

    isPlaying = true;
    const rawData = audioQueue.shift();

    if (rawData) {
      try {
        // decodeAudioData はバッファを消費するのでコピーを渡す
        const audioBuffer = await audioContext.decodeAudioData(
          rawData.slice(0),
        );

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
        isPlaying = false;
        playNextInQueue();
      }
    } else {
      isPlaying = false;
    }
  }

  function handleAudioChunk(content: unknown): void {
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
      rawData = content.buffer as ArrayBuffer;
    } else {
      console.warn("[MakaseteAI] Unexpected audio format");
      return;
    }

    audioQueue.push(rawData);
    playNextInQueue();
  }

  function resetAudioState(): void {
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
    rec.lang = language === "en" ? "en-US" : "ja-JP";
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
        const transcript = result[0].transcript;
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

  function toggleRecording(): void {
    if (!recognition) return;

    if (isRecording) {
      recognition.stop();
    } else {
      finalTranscript = "";
      recognition.start();
      isRecording = true;
    }
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
    toggleRecording,
    isSpeechRecognitionSupported,
    cleanup,
  };
}
