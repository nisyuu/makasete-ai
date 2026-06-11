import { io, Socket } from "socket.io-client";

export interface SocketHandlerOptions {
  serverUrl: string;
  onTextChunk: (content: string) => void;
  onAudioChunk: (data: { type: "text" | "audio"; content: unknown }) => void;
  onError: (message: string) => void;
  onConnect?: () => void;
  onResponseComplete?: () => void;
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
  const { serverUrl, onTextChunk, onAudioChunk, onError, onConnect, onResponseComplete } = options;

  const socket: Socket = io(serverUrl);

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

  function sendUserInput(text: string, isVoiceInput: boolean, language = "ja"): void {
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
