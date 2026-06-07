import { Server, Socket } from "socket.io";
import { ResponseOrchestrator } from "../services/responseOrchestrator";
import { ChatMessage } from "../services/chatService";

function getClientIp(socket: Socket): string {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (forwarded) {
    return (
      Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0]
    ).trim();
  }
  return socket.handshake.address;
}

/**
 * Registers Socket.io event handlers.
 * Acts as the Controller layer: delegates business logic to ResponseOrchestrator.
 */
export function registerSocketHandlers(
  io: Server,
  orchestrator: ResponseOrchestrator,
): void {
  const socketConnections = new Map<string, number>();

  io.use((socket, next) => {
    const clientIp = getClientIp(socket);
    const count = socketConnections.get(clientIp) || 0;
    if (count >= 5) {
      return next(new Error("Too many connections"));
    }
    socketConnections.set(clientIp, count + 1);
    next();
  });

  io.on("connection", (socket) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chatHistory: ChatMessage[] = [];

    socket.on(
      "user-input",
      async (data: { text: string; isVoiceInput: boolean }) => {
        const { text, isVoiceInput } = data;

        if (!text || typeof text !== "string" || text.length > 1000) {
          socket.emit("error", { message: "Input is invalid" });
          return;
        }

        chatHistory.push({ role: "user", parts: [{ text }] });

        if (chatHistory.length > 20) {
          chatHistory.splice(0, 2);
        }

        await orchestrator.processMessage(
          { text, isVoiceInput },
          chatHistory,
          {
            onVoiceChunk: async (uiText, audioBuffer) => {
              socket.emit("audio-chunk", { type: "text", content: uiText });
              await new Promise<void>((resolve) => {
                socket.emit("audio-chunk", {
                  type: "audio",
                  content: audioBuffer,
                });
                setTimeout(resolve, 50);
              });
            },
            onTextChunk: (uiText) => {
              socket.emit("text-chunk", { content: uiText });
            },
            onComplete: () => {
              socket.emit("response-complete");
            },
            onError: (error) => {
              console.error("Error processing input:", error.message);
              socket.emit("error", {
                message: "Internal server error occurred.",
              });
            },
          },
        );
      },
    );

    socket.on("disconnect", () => {
      const clientIp = getClientIp(socket);
      const count = socketConnections.get(clientIp);
      if (count && count > 1) {
        socketConnections.set(clientIp, count - 1);
      } else {
        socketConnections.delete(clientIp);
      }
    });
  });
}
