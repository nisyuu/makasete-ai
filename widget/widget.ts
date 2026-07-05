import widgetStyles from "./styles.css?inline";
import { initSocketHandler, SocketHandler } from "./utils/socketHandler";
import { initAudioHandler, AudioHandler } from "./utils/audioHandler";
import { initDragHandler } from "./utils/dragHandler";
import {
  getUIElements,
  updateInputActions,
  showTypingIndicator,
  appendMessage,
  appendRecommendations,
  applyPrimaryColor,
  hideLoadingOverlay,
  MessageState,
} from "./utils/uiRenderer";
import { parseSettings } from "./utils/settings";

interface WidgetConfig {
  serverUrl?: string;
  title?: string;
  placeholder?: string;
  language?: "ja" | "en";
}

/** 音声読み上げ ON（スピーカー）アイコン */
const ICON_AUDIO_ON = `<svg class="lucide lucide-volume-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`;
/** 音声読み上げ OFF（ミュート）アイコン */
const ICON_AUDIO_OFF = `<svg class="lucide lucide-volume-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>`;

/** ウィジェットのリッチUIマークアップ（ランチャーボタン・チャットウィンドウ等） */
function buildWidgetMarkup(placeholder: string, helperText: string): string {
  return `
    <div class="widget-container">
      <div class="chat-window">
        <div class="chat-header">
          <span class="chat-title"></span>
          <div class="header-controls">
            <button class="audio-toggle-btn" aria-pressed="false">
              ${ICON_AUDIO_OFF}
            </button>
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

  // 音声読み上げ ON/OFF トグルボタン（ヘッダー内）
  const audioToggleBtn = shadow.querySelector(
    ".audio-toggle-btn",
  ) as HTMLButtonElement;

  /** トグルボタンの表示（アイコン・タイトル・aria）を現在の状態に合わせて更新する */
  function updateAudioToggle(): void {
    audioToggleBtn.innerHTML = isAudioEnabled ? ICON_AUDIO_ON : ICON_AUDIO_OFF;
    audioToggleBtn.setAttribute("aria-pressed", String(isAudioEnabled));
    audioToggleBtn.title = isAudioEnabled
      ? isEn
        ? "Turn voice replies off"
        : "音声読み上げをオフにする"
      : isEn
        ? "Turn voice replies on"
        : "音声読み上げをオンにする";
  }

  // --- Audio ---
  const audio: AudioHandler = initAudioHandler({
    onTranscript: (text) => {
      // 認識途中のテキストは入力欄にプレビュー表示するだけで送信しない。
      // （録音中はマイクボタンを出したままにするため updateInputActions は呼ばない）
      els.input.value = text;
    },
    onRecordingEnd: (finalText) => {
      els.micBtn.classList.remove("recording");
      // 発話が確定したタイミングで、一区切りのテキストとして一度だけ送信する。
      const text = (finalText ?? "").trim();
      if (text) {
        els.input.value = text;
        sendMessage(true);
      }
    },
    onError: (error) => {
      // 音声認識のエラーをユーザーに通知する。
      // no-speech / aborted は通常操作の範囲なので通知しない。
      const code = error.message;
      if (code === "no-speech" || code === "aborted") return;

      let message: string;
      switch (code) {
        case "not-allowed":
        case "service-not-allowed":
          message = isEn
            ? "Microphone access is blocked. Please allow it in your browser settings."
            : "マイクの使用が許可されていません。ブラウザの設定をご確認ください。";
          break;
        case "audio-capture":
          message = isEn
            ? "No microphone was found. Please check your device."
            : "マイクが見つかりませんでした。デバイスをご確認ください。";
          break;
        case "network":
          message = isEn
            ? "A network error occurred during speech recognition."
            : "音声認識中にネットワークエラーが発生しました。";
          break;
        default:
          message = isEn
            ? "Speech recognition failed. Please try again."
            : "音声認識でエラーが発生しました。もう一度お試しください。";
      }
      // 録音表示が残らないように解除してからメッセージを表示する
      els.micBtn.classList.remove("recording");
      appendMessage(els.timeline, messageState, "makasete-server", message);
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
    onRecommendation: (products) => {
      appendRecommendations(els.timeline, products);
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
    // 実際の録音状態に合わせてボタン表示を更新する
    // （start() が失敗した場合に表示だけ録音中になるのを防ぐ）
    const recording = audio.toggleRecording();
    els.micBtn.classList.toggle("recording", recording);
    // マイク利用開始時にボットの音声出力も自動で有効化する
    if (recording) {
      isAudioEnabled = true;
      updateAudioToggle();
    }
  });

  // 音声読み上げの ON/OFF を手動で切り替える。
  // OFF にしたときは再生中の音声も止める。
  audioToggleBtn.addEventListener("click", () => {
    isAudioEnabled = !isAudioEnabled;
    if (isAudioEnabled) {
      audio.resumeAudioContext().catch(console.error);
    } else {
      audio.resetAudioState();
    }
    updateAudioToggle();
  });

  // 初期表示（アイコン・タイトル）を状態に合わせて設定する
  updateAudioToggle();

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

  // --- データ準備の完了を待ち、settings シートの設定を反映してローディングを解除 ---
  // Google Sheets の settings シート（primary_color / initial_message / chat_title）を
  // 取得して表示に反映する。Sheets が唯一の真実であり、取得に失敗した場合や設定が
  // 無い場合のみ config 由来のデフォルトへフォールバックする。
  async function initializeWidget(): Promise<void> {
    let greetingToRender = greeting;

    try {
      // /health はサーバー側でデータ取得完了までブロックする
      const healthResponse = await fetch(`${serverUrl}/health`);
      if (!healthResponse.ok) {
        console.warn("[MakaseteAI] Failed to verify data readiness");
      }

      const settingsResponse = await fetch(`${serverUrl}/api/settings`);
      if (settingsResponse.ok) {
        const settings = parseSettings(await settingsResponse.json());
        if (settings.title) els.chatTitle.textContent = settings.title;
        if (settings.primaryColor) applyPrimaryColor(shadow, settings.primaryColor);
        if (settings.initialMessage) greetingToRender = settings.initialMessage;
      }
    } catch (e) {
      console.error("[MakaseteAI] Error waiting for data:", e);
    } finally {
      // 初回の挨拶メッセージ（settings 反映後に一度だけ表示する）
      appendMessage(els.timeline, messageState, "makasete-server", greetingToRender);
      hideLoadingOverlay(els.loadingOverlay);
    }
  }

  void initializeWidget();
}
