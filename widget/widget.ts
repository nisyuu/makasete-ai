import { initSocketHandler } from "./utils/socketHandler";
import { initAudioHandler } from "./utils/audioHandler";
import {
  appendMessage,
  showTypingIndicator,
  hideTypingIndicator,
  updateInputActions,
  applyPrimaryColor,
  hideLoadingOverlay,
  MessageState,
} from "./utils/uiRenderer";
import { initDragHandler } from "./utils/dragHandler";

export interface WidgetConfig {
  serverUrl?: string;
  title?: string;
  placeholder?: string;
  primaryColor?: string;
  /** 応答言語コード。'ja'（日本語、デフォルト）または 'en'（英語）など */
  language?: string;
}

const WIDGET_HTML = `
<div class="widget-container">
  <div class="loading-overlay">
    <div class="loading-spinner"></div>
  </div>
  <button class="launcher-button" aria-label="チャットを開く">
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
    </svg>
  </button>
  <div class="chat-window" style="display:none">
    <div class="chat-header">
      <span class="chat-title"></span>
      <button class="close-btn" aria-label="閉じる">✕</button>
    </div>
    <div class="chat-timeline"></div>
    <div class="input-area">
      <textarea class="text-input" rows="1"></textarea>
      <button class="send-btn" style="display:none" aria-label="送信">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
      <button class="mic-btn" aria-label="音声入力">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.42 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
        </svg>
      </button>
    </div>
  </div>
</div>
`;

const WIDGET_CSS = `
  :host {
    --primary-color: #4f46e5;
  }
  *, *::before, *::after { box-sizing: border-box; }

  .widget-container {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
  }

  .loading-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2147483648;
  }
  .loading-overlay.hidden { display: none; }
  .loading-spinner {
    width: 40px; height: 40px;
    border: 3px solid rgba(255,255,255,0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .launcher-button {
    width: 56px; height: 56px;
    border-radius: 50%;
    background: var(--primary-color);
    color: white;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 14px rgba(0,0,0,0.25);
    transition: transform 0.2s, box-shadow 0.2s;
  }
  .launcher-button:hover { transform: scale(1.08); box-shadow: 0 6px 18px rgba(0,0,0,0.3); }

  .chat-window {
    position: fixed;
    bottom: 86px;
    right: 20px;
    width: 360px;
    height: 520px;
    background: white;
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.15);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: slideUp 0.2s ease-out;
  }
  @keyframes slideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }

  .chat-header {
    background: var(--primary-color);
    color: white;
    padding: 14px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    cursor: default;
  }
  .chat-title { font-weight: 600; font-size: 15px; }
  .close-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,0.7);
    cursor: pointer;
    font-size: 16px;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
    transition: color 0.15s;
  }
  .close-btn:hover { color: white; }

  .chat-timeline {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    scroll-behavior: smooth;
  }
  .chat-timeline::-webkit-scrollbar { width: 4px; }
  .chat-timeline::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 2px; }

  .message {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 14px;
    line-height: 1.5;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .message.user {
    align-self: flex-end;
    background: var(--primary-color);
    color: white;
    border-bottom-right-radius: 4px;
  }
  .message.makasete-server {
    align-self: flex-start;
    background: #f3f4f6;
    color: #111827;
    border-bottom-left-radius: 4px;
  }
  .message a { color: inherit; text-decoration: underline; }

  .typing-indicator {
    display: flex;
    gap: 4px;
    padding: 10px 14px;
    background: #f3f4f6;
    border-radius: 14px;
    border-bottom-left-radius: 4px;
    align-self: flex-start;
    width: fit-content;
  }
  .typing-dot {
    width: 8px; height: 8px;
    background: #9ca3af;
    border-radius: 50%;
    animation: bounce 1.2s ease-in-out infinite;
  }
  .typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .typing-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }

  .input-area {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 12px;
    border-top: 1px solid #e5e7eb;
    background: white;
    flex-shrink: 0;
  }
  .text-input {
    flex: 1;
    resize: none;
    border: 1px solid #d1d5db;
    border-radius: 20px;
    padding: 9px 16px;
    font-size: 14px;
    font-family: inherit;
    line-height: 1.4;
    max-height: 120px;
    outline: none;
    transition: border-color 0.15s;
    background: #f9fafb;
  }
  .text-input:focus { border-color: var(--primary-color); background: white; }
  .text-input:disabled { opacity: 0.6; }

  .send-btn, .mic-btn {
    width: 38px; height: 38px;
    border-radius: 50%;
    background: var(--primary-color);
    color: white;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: filter 0.15s;
  }
  .send-btn:hover, .mic-btn:hover { filter: brightness(1.1); }
  .send-btn:disabled, .mic-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .mic-btn.recording { background: #ef4444; animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.75; } }

  @media (max-width: 480px) {
    .chat-window { width: 100vw; height: 100dvh; bottom: 0; right: 0; border-radius: 0; }
    .widget-container { bottom: 16px; right: 16px; }
  }
`;

export function initChatWidget(config: WidgetConfig = {}): void {
  const {
    serverUrl = "",
    title = "Chat Assistant",
    placeholder = "Type a message...",
    primaryColor,
    language = "ja",
  } = config;

  // Shadow DOM host
  const host = document.createElement("div");
  const shadowRoot = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = WIDGET_CSS;
  shadowRoot.appendChild(styleEl);

  const template = document.createElement("template");
  template.innerHTML = WIDGET_HTML;
  shadowRoot.appendChild(template.content.cloneNode(true));

  document.body.appendChild(host);

  // Element references
  const container = shadowRoot.querySelector(
    ".widget-container",
  ) as HTMLElement;
  const timeline = shadowRoot.querySelector(".chat-timeline") as HTMLElement;
  const inputEl = shadowRoot.querySelector(
    ".text-input",
  ) as HTMLTextAreaElement;
  const sendBtn = shadowRoot.querySelector(".send-btn") as HTMLButtonElement;
  const micBtn = shadowRoot.querySelector(".mic-btn") as HTMLButtonElement;
  const launcherBtn = shadowRoot.querySelector(
    ".launcher-button",
  ) as HTMLButtonElement;
  const chatWindow = shadowRoot.querySelector(".chat-window") as HTMLElement;
  const chatTitle = shadowRoot.querySelector(".chat-title") as HTMLElement;
  const closeBtn = shadowRoot.querySelector(".close-btn") as HTMLButtonElement;
  const loadingOverlay = shadowRoot.querySelector(
    ".loading-overlay",
  ) as HTMLElement;

  chatTitle.textContent = title;
  inputEl.placeholder = placeholder;
  if (primaryColor) applyPrimaryColor(shadowRoot, primaryColor);

  const messageState: MessageState = {
    currentMakaseteServerMessageRaw: "",
  };
  let isWaitingForResponse = false;

  function setInputDisabled(disabled: boolean): void {
    inputEl.disabled = disabled;
    sendBtn.disabled = disabled;
    micBtn.disabled = disabled;
  }

  // Audio handler
  const audioHandler = initAudioHandler({
    onTranscript: (text) => {
      inputEl.value = text;
      updateInputActions(inputEl, sendBtn, micBtn);
      sendMessage(true);
    },
    onRecordingEnd: () => {
      micBtn.classList.remove("recording");
    },
    onError: (err) => {
      console.error("[MakaseteAI] Speech recognition error:", err);
    },
    language,
  });

  // Socket handler — text-chunk events display incrementally (streaming)
  const socketHandler = initSocketHandler({
    serverUrl,
    onTextChunk: (content) => {
      hideTypingIndicator(timeline);
      appendMessage(timeline, messageState, "makasete-server", content, true);
    },
    onAudioChunk: (data) => {
      if (data.type === "text") {
        hideTypingIndicator(timeline);
        appendMessage(
          timeline,
          messageState,
          "makasete-server",
          data.content as string,
          true,
        );
      } else if (data.type === "audio") {
        audioHandler.handleAudioChunk(data.content);
      }
    },
    onError: (message) => {
      hideTypingIndicator(timeline);
      isWaitingForResponse = false;
      setInputDisabled(false);
      console.error("[MakaseteAI] Socket error:", message);
    },
    onConnect: () => {
      hideLoadingOverlay(loadingOverlay);
    },
    onResponseComplete: () => {
      isWaitingForResponse = false;
      setInputDisabled(false);
      messageState.currentMakaseteServerMessageRaw = "";
    },
  });

  function sendMessage(voiceInput = false): void {
    const text = inputEl.value.trim();
    if (!text || isWaitingForResponse) return;

    isWaitingForResponse = true;
    inputEl.value = "";
    updateInputActions(inputEl, sendBtn, micBtn);
    setInputDisabled(true);

    if (voiceInput) {
      audioHandler.resumeAudioContext();
      audioHandler.resetAudioState();
    }

    appendMessage(timeline, messageState, "user", text);
    messageState.currentMakaseteServerMessageRaw = "";
    showTypingIndicator(timeline);

    socketHandler.sendUserInput(text, voiceInput, language);
  }

  // Drag support (desktop)
  const chatHeader = shadowRoot.querySelector(".chat-header") as HTMLElement;
  initDragHandler(container, [launcherBtn, chatHeader], launcherBtn, () => {});

  // Event listeners
  launcherBtn.addEventListener("click", () => {
    audioHandler.initAudioContext();
    chatWindow.style.display = "flex";
    launcherBtn.style.display = "none";
    inputEl.focus();
  });

  closeBtn.addEventListener("click", () => {
    chatWindow.style.display = "none";
    launcherBtn.style.display = "flex";
  });

  sendBtn.addEventListener("click", () => sendMessage(false));

  inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(false);
    }
  });

  inputEl.addEventListener("input", () => {
    updateInputActions(inputEl, sendBtn, micBtn);
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  });

  micBtn.addEventListener("click", () => {
    if (!audioHandler.isSpeechRecognitionSupported()) return;
    micBtn.classList.toggle("recording");
    audioHandler.resumeAudioContext();
    audioHandler.toggleRecording();
  });
}
