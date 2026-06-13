import widgetStyles from "./styles.css?inline";
import { initSocketHandler, SocketHandler } from "./utils/socketHandler";
import { initAudioHandler, AudioHandler } from "./utils/audioHandler";
import { initDragHandler } from "./utils/dragHandler";
import {
  getUIElements,
  updateInputActions,
  showTypingIndicator,
  appendMessage,
  hideLoadingOverlay,
  MessageState,
} from "./utils/uiRenderer";

interface WidgetConfig {
  serverUrl?: string;
  title?: string;
  placeholder?: string;
  language?: "ja" | "en";
}

/** ウィジェットのリッチUIマークアップ（ランチャーボタン・チャットウィンドウ等） */
function buildWidgetMarkup(placeholder: string, helperText: string): string {
  return `
    <div class="widget-container">
      <div class="chat-window">
        <div class="chat-header">
          <span class="chat-title"></span>
          <div class="header-controls">
            <button class="close-btn" title="閉じる">
              <svg class="lucide lucide-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        </div>
        <div class="chat-timeline"></div>
        <div class="input-area">
          <div class="input-wrapper">
            <textarea class="text-input" placeholder="${placeholder}" rows="1"></textarea>
            <div class="input-helper">${helperText}</div>
          </div>
          <div class="input-actions">
            <button class="btn mic-btn" title="音声入力">
              <svg class="lucide lucide-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
            </button>
            <button class="btn send-btn" title="送信" style="display: none;">
              <svg class="lucide lucide-send" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
            </button>
          </div>
        </div>
        <div class="widget-footer">Powered by Makasete AI</div>
        <div class="loading-overlay">
          <div class="spinner"></div>
          <div class="loading-text">準備中です。少々お待ちください...</div>
        </div>
      </div>
      <button class="launcher-button" title="AIアシスタントに相談する">
        <svg class="launcher-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 8V4H8"></path>
          <rect width="16" height="12" x="4" y="8" rx="2"></rect>
          <path d="M2 14h2"></path>
          <path d="M20 14h2"></path>
          <path d="M15 13v2"></path>
          <path d="M9 13v2"></path>
        </svg>
      </button>
    `;
}

export function initChatWidget(config: WidgetConfig = {}): void {
  const {
    serverUrl = window.location.origin,
    title = "AIアシスタント",
    placeholder = "質問を入力...",
    language = "ja",
  } = config;

  const isEn = language === "en";
  const helperText = isEn ? "Cmd(Ctrl) + Enter to send" : "Command(Ctrl) + Enterで送信";
  const greeting = isEn
    ? "Hi, I'm your AI assistant. How can I help you?"
    : "AIアシスタントです。何かお手伝いできることはありますか？";

  // Shadow DOM for style isolation
  const host = document.createElement("div");
  host.id = "makasete-ai-widget-host";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = widgetStyles;
  shadow.appendChild(style);

  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildWidgetMarkup(placeholder, helperText);
  // innerHTML を直接 shadow に展開する（widget-container を維持）
  while (wrapper.firstChild) {
    shadow.appendChild(wrapper.firstChild);
  }

  const els = getUIElements(shadow);
  els.chatTitle.textContent = title;

  const messageState: MessageState = { currentMakaseteServerMessageRaw: "" };

  // ボットの音声出力が有効かどうか（マイク利用時に自動で有効化される）
  let isAudioEnabled = false;
  // ドラッグ操作中かどうか（ランチャーのクリック判定で使用）
  let isDragging = false;

  // --- Audio ---
  const audio: AudioHandler = initAudioHandler({
    onTranscript: (text) => {
      els.input.value = text;
      sendMessage(true);
    },
    onRecordingEnd: () => {
      els.micBtn.classList.remove("recording");
    },
    language,
  });

  // 音声認識が使えない環境ではマイクボタンを隠し、送信ボタンを常時表示する
  if (!audio.isSpeechRecognitionSupported()) {
    els.micBtn.style.display = "none";
    els.sendBtn.style.display = "flex";
  }

  // --- Socket ---
  const socket: SocketHandler = initSocketHandler({
    serverUrl,
    onTextChunk: (content) => {
      appendMessage(els.timeline, messageState, "makasete-server", content, true);
    },
    onAudioChunk: (data) => {
      if (data.type === "text") {
        appendMessage(
          els.timeline,
          messageState,
          "makasete-server",
          data.content as string,
          true,
        );
      } else if (data.type === "audio") {
        audio.handleAudioChunk(data.content);
      }
    },
    onError: (message) => {
      const prefix = isEn ? "An error occurred: " : "エラーが発生しました: ";
      appendMessage(
        els.timeline,
        messageState,
        "makasete-server",
        `${prefix}${message}`,
      );
    },
    onResponseComplete: () => {
      els.input.focus();
    },
    onConnect: () => {
      console.log("[MakaseteAI] Connected");
    },
  });

  // --- Send ---
  function sendMessage(isVoiceInput = false): void {
    const text = els.input.value.trim();
    if (!text) return;

    const useAudio = isVoiceInput || isAudioEnabled;

    appendMessage(els.timeline, messageState, "user", text);
    els.input.value = "";
    updateInputActions(els.input, els.sendBtn, els.micBtn);
    showTypingIndicator(els.timeline);

    if (useAudio) {
      audio.resetAudioState();
      audio.resumeAudioContext().catch(console.error);
    }

    socket.sendUserInput(text, useAudio, language);
  }

  // --- Events ---
  els.sendBtn.addEventListener("click", () => {
    audio.resumeAudioContext().catch(console.error);
    sendMessage();
  });

  els.input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      audio.resumeAudioContext().catch(console.error);
      sendMessage();
    }
  });

  els.input.addEventListener("input", () => {
    updateInputActions(els.input, els.sendBtn, els.micBtn);
  });

  els.micBtn.addEventListener("click", () => {
    if (!audio.isSpeechRecognitionSupported()) {
      alert(isEn ? "Speech recognition is not available in this browser." : "音声認識はこのブラウザでは利用できません");
      return;
    }
    audio.resumeAudioContext().catch(console.error);
    audio.initAudioContext();
    audio.toggleRecording();
    const recording = els.micBtn.classList.toggle("recording");
    // マイク利用開始時にボットの音声出力も自動で有効化する
    if (recording) isAudioEnabled = true;
  });

  els.launcherBtn.addEventListener("click", () => {
    if (isDragging) return; // ドラッグ中はトグルしない
    const isOpen = els.chatWindow.classList.toggle("open");

    // モバイルでは開いている間 body のスクロールを止める
    if (window.innerWidth <= 600) {
      document.body.style.overflow = isOpen ? "hidden" : "";
    }

    if (isOpen) {
      audio.resumeAudioContext().catch(console.error);
    } else {
      audio.resetAudioState();
    }
  });

  if (els.closeBtn) {
    els.closeBtn.addEventListener("click", () => {
      els.chatWindow.classList.remove("open");
      document.body.style.overflow = "";
      audio.resetAudioState();
    });
  }

  // --- Drag ---
  const header = shadow.querySelector(".chat-header") as HTMLElement;
  initDragHandler(els.container, [els.launcherBtn, header], els.launcherBtn, (dragging) => {
    isDragging = dragging;
  });

  // --- データ準備の完了を待ってローディングを解除 ---
  fetch(`${serverUrl}/health`)
    .then((response) => {
      if (response.ok) {
        hideLoadingOverlay(els.loadingOverlay);
      }
    })
    .catch((e) => {
      console.error("[MakaseteAI] Error waiting for data:", e);
    });

  // 初回の挨拶メッセージ
  appendMessage(els.timeline, messageState, "makasete-server", greeting);
}
