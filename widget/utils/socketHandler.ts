import { io, Socket } from "socket.io-client";
import type { Product } from "../types";

export type { Product };

/**
 * 接続が失われたときの理由。
 * - "connect-timeout": 送信しようとしたが一定時間内に接続できなかった
 * - "disconnected": 応答を待っている間に接続が切れた
 */
export type ConnectionLostReason = "connect-timeout" | "disconnected";

export interface SocketHandlerOptions {
  serverUrl: string;
  onTextChunk: (content: string) => void;
  onAudioChunk: (data: { type: "text" | "audio"; content: unknown }) => void;
  onError: (message: string) => void;
  onConnect?: () => void;
  onResponseComplete?: () => void;
  onRecommendation?: (products: Product[]) => void;
  /** 応答待ちの途中で接続が失われた（または接続できなかった）ときに呼ばれる */
  onConnectionLost?: (reason: ConnectionLostReason) => void;
  /** 未接続時に送信した場合、接続を待つ最大時間（ミリ秒） */
  connectTimeoutMs?: number;
}

export interface SocketHandler {
  /** ユーザーメッセージをサーバーに送信する */
  sendUserInput: (text: string, isVoiceInput: boolean, language?: string) => void;
  /** Socket接続を切断する */
  disconnect: () => void;
  /** 接続中かどうか */
  isConnected: () => boolean;
}

type RequestId = string;

interface ServerEvent {
  requestId?: unknown;
}

/**
 * Socket.io の接続・イベントハンドリングを初期化する
 */
export function initSocketHandler(
  options: SocketHandlerOptions,
): SocketHandler {
  const {
    serverUrl,
    onTextChunk,
    onAudioChunk,
    onError,
    onConnect,
    onResponseComplete,
    onRecommendation,
    onConnectionLost,
    connectTimeoutMs = 10000,
  } = options;

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

  // 現在応答を待っているリクエストの ID。これと違う ID のイベントは、
  // 割り込まれた古い応答の取り残しなので捨てる。
  let currentRequestId: RequestId | null = null;
  let requestCounter = 0;
  // 応答（完了またはエラー）を待っているかどうか
  let awaitingResponse = false;
  // 未接続時の送信で、接続を待っている処理の後始末
  let cancelPendingSend: (() => void) | null = null;

  function nextRequestId(): RequestId {
    requestCounter += 1;
    return `${Date.now().toString(36)}-${requestCounter}`;
  }

  /**
   * 現在のリクエスト宛てのイベントか。ID を持たないイベント（ID 未対応の
   * 古いサーバーや、リクエストに紐づかないエラー）は受け入れる。
   */
  function isCurrent(data: unknown): boolean {
    if (data === null || typeof data !== "object") return true;
    const { requestId } = data as ServerEvent;
    if (requestId === undefined) return true;
    return requestId === currentRequestId;
  }

  function finishRequest(): void {
    awaitingResponse = false;
  }

  function reportConnectionLost(reason: ConnectionLostReason): void {
    finishRequest();
    onConnectionLost?.(reason);
  }

  socket.io.on("reconnect_failed", () => {
    // ウィジェットを開いていないページでも動作するため、チャット欄への
    // エラー表示はせず console 警告に留める。
    console.warn(
      "[MakaseteAI] サーバーに接続できないため自動再接続を停止しました",
    );
    // 送信のために接続を待っている最中なら、待たずに失敗を知らせる
    if (cancelPendingSend) {
      cancelPendingSend();
      reportConnectionLost("connect-timeout");
    }
  });

  socket.on("connect", () => {
    onConnect?.();
  });

  socket.on("disconnect", (reason: string) => {
    // 自分から切断した場合は通知しない
    if (reason === "io client disconnect") return;
    // 応答を待っていなければユーザーに知らせる必要はない（裏で再接続する）
    if (!awaitingResponse) return;
    reportConnectionLost("disconnected");
  });

  socket.on("text-chunk", (data: { content: string } & ServerEvent) => {
    if (!isCurrent(data)) return;
    onTextChunk(data.content);
  });

  socket.on(
    "audio-chunk",
    (data: { type: "text" | "audio"; content: unknown } & ServerEvent) => {
      if (!isCurrent(data)) return;
      onAudioChunk(data);
    },
  );

  socket.on("error", (data: { message: string } & ServerEvent) => {
    if (!isCurrent(data)) return;
    finishRequest();
    onError(data.message);
  });

  socket.on("response-complete", (data?: ServerEvent) => {
    if (!isCurrent(data)) return;
    finishRequest();
    onResponseComplete?.();
  });

  socket.on("recommendation", (data: { products: Product[] } & ServerEvent) => {
    if (!isCurrent(data)) return;
    onRecommendation?.(data.products);
  });

  function emitUserInput(payload: Record<string, unknown>): void {
    socket.emit("user-input", payload);
  }

  function sendUserInput(text: string, isVoiceInput: boolean, language = "ja"): void {
    // 前の送信が接続待ちなら、その送信は取りやめる（新しい入力が優先）
    cancelPendingSend?.();

    const requestId = nextRequestId();
    currentRequestId = requestId;
    awaitingResponse = true;
    const payload = { text, isVoiceInput, language, requestId };

    if (socket.connected) {
      emitUserInput(payload);
      return;
    }

    // 未接続のまま emit すると socket.io がバッファし、いつ届くか分からない。
    // 接続できないまま待たされ続けたり、ずっと後で古い入力が突然送られたり
    // するのを防ぐため、接続を待つ時間に上限を設ける。
    // リトライ上限到達後もユーザー操作を契機に接続を復帰できるようにする。
    const onConnected = (): void => {
      cleanup();
      emitUserInput(payload);
    };
    const timer = setTimeout(() => {
      cleanup();
      reportConnectionLost("connect-timeout");
    }, connectTimeoutMs);
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("connect", onConnected);
      cancelPendingSend = null;
    };

    cancelPendingSend = cleanup;
    socket.once("connect", onConnected);
    socket.connect();
  }

  function disconnect(): void {
    cancelPendingSend?.();
    socket.disconnect();
  }

  return {
    sendUserInput,
    disconnect,
    isConnected: () => socket.connected,
  };
}
