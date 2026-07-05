import { io, Socket } from "socket.io-client";
import type { Product } from "../types";

export type { Product };

export interface SocketHandlerOptions {
  serverUrl: string;
  onTextChunk: (content: string) => void;
  onAudioChunk: (data: { type: "text" | "audio"; content: unknown }) => void;
  onError: (message: string) => void;
  onConnect?: () => void;
  onResponseComplete?: () => void;
  onRecommendation?: (products: Product[]) => void;
}

export interface SocketHandler {
  /** ユーザーメッセージをサーバーに送信する */
  sendUserInput: (text: string, isVoiceInput: boolean, language?: string) => void;
  /** Socket接続を切断する */
  disconnect: () => void;
  /** 接続中かどうか */
  isConnected: () => boolean;
}

/**
 * Socket.io の接続・イベントハンドリングを初期化する
 */
export function initSocketHandler(
  options: SocketHandlerOptions,
): SocketHandler {
  const { serverUrl, onTextChunk, onAudioChunk, onError, onConnect, onResponseComplete, onRecommendation } = options;

  // Firebase App Hosting などのプロキシは既定の `/socket.io/` から末尾スラッシュを
  // 除去して転送し、サーバ側でパスが一致せず 404 になることがある。クライアント側でも
  // 末尾スラッシュを付けずに接続し、サーバの設定と揃える。
  const socket: Socket = io(serverUrl, {
    addTrailingSlash: false,
    // 接続先が恒久的に 404 を返す場合（誤設定など）に無限リトライで
    // リクエストを流し続けないよう、試行回数に上限を設ける。
    // 初回リトライは 1 秒で一時切断からの低遅延復帰を維持しつつ、
    // 指数バックオフで最大 30 秒まで間隔を広げる（計 ~10 回 / ~3 分）。
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
  });

  socket.io.on("reconnect_failed", () => {
    // ウィジェットを開いていないページでも動作するため、チャット欄への
    // エラー表示はせず console 警告に留める。
    console.warn(
      "[MakaseteAI] サーバーに接続できないため自動再接続を停止しました",
    );
  });

  socket.on("connect", () => {
    onConnect?.();
  });

  socket.on("text-chunk", (data: { content: string }) => {
    onTextChunk(data.content);
  });

  socket.on(
    "audio-chunk",
    (data: { type: "text" | "audio"; content: unknown }) => {
      onAudioChunk(data);
    },
  );

  socket.on("error", (data: { message: string }) => {
    onError(data.message);
  });

  socket.on("response-complete", () => {
    onResponseComplete?.();
  });

  socket.on("recommendation", (data: { products: Product[] }) => {
    onRecommendation?.(data.products);
  });

  function sendUserInput(text: string, isVoiceInput: boolean, language = "ja"): void {
    // リトライ上限到達後もユーザー操作を契機に接続を復帰できるようにする
    if (!socket.connected) {
      socket.connect();
    }
    socket.emit("user-input", { text, isVoiceInput, language });
  }

  function disconnect(): void {
    socket.disconnect();
  }

  return {
    sendUserInput,
    disconnect,
    isConnected: () => socket.connected,
  };
}
