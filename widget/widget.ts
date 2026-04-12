import { io, Socket } from "socket.io-client";
import { normalizeSettingKey, formatMessageText } from "./utils/text";

interface BufferData {
  type: "Buffer";
  data: number[];
}

/** Supported locale codes (must mirror server/config.ts SUPPORTED_LOCALES) */
const SUPPORTED_LOCALES = ['ja', 'en', 'zh-CN'] as const;
type Locale = typeof SUPPORTED_LOCALES[number];

/** Per-locale UI string definitions */
const i18n: Record<Locale, Record<string, string>> = {
  ja: {
    placeholder: '質問を入力...',
    inputHelper: 'Command(Ctrl) + Enterで送信',
    send: '送信',
    mic: '音声入力',
    close: '閉じる',
    error: 'エラーが発生しました',
    defaultTitle: 'AIアシスタント',
    defaultGreeting: 'AIアシスタントです。何かお手伝いできることはありますか？',
    loading: '準備中です。少々お待ちください...',
    poweredBy: 'Powered by Makasete AI',
  },
  en: {
    placeholder: 'Type a message...',
    inputHelper: 'Press Ctrl + Enter to send',
    send: 'Send',
    mic: 'Voice input',
    close: 'Close',
    error: 'An error occurred',
    defaultTitle: 'AI Assistant',
    defaultGreeting: 'Hello! How can I help you today?',
    loading: 'Loading, please wait...',
    poweredBy: 'Powered by Makasete AI',
  },
  'zh-CN': {
    placeholder: '输入消息...',
    inputHelper: '按 Ctrl + Enter 发送',
    send: '发送',
    mic: '语音输入',
    close: '关闭',
    error: '发生了错误',
    defaultTitle: '智能助手',
    defaultGreeting: '您好！有什么可以帮助您的吗？',
    loading: '正在加载，请稍候...',
    poweredBy: 'Powered by Makasete AI',
  },
};

export class ChatWidget {
  private shadowRoot: ShadowRoot;
  private socket: Socket;
  private audioQueue: ArrayBuffer[] = [];
  private isPlaying = false;

  // Web Audio API
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;

  // UI Elements
  private container: HTMLElement;
  private chatWindow: HTMLElement;
  private chatTitle: HTMLElement;
  private timeline: HTMLElement;
  private input: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private micBtn: HTMLButtonElement;
  private launcherBtn: HTMLButtonElement;
  private loadingOverlay: HTMLElement;
  private loadingText: HTMLElement;
  private inputHelper: HTMLElement;
  private widgetFooter: HTMLElement;

  // State
  private isRecording = false;
  private isAudioEnabled = false;
  private recognition: SpeechRecognition | null = null;
  private serverUrl: string;
  private locale: Locale;

  // Dragging state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private containerPosX = 0;
  private containerPosY = 0;

  constructor(shadowRoot: ShadowRoot, serverUrl: string, locale: Locale = 'ja') {
    this.shadowRoot = shadowRoot;
    this.serverUrl = serverUrl;
    this.locale = SUPPORTED_LOCALES.includes(locale) ? locale : 'ja';
    this.socket = io(serverUrl);

    // Element binding
    this.container = this.shadowRoot.querySelector(
      ".widget-container",
    ) as HTMLElement;
    this.chatWindow = this.shadowRoot.querySelector(
      ".chat-window",
    ) as HTMLElement;
    this.chatTitle = this.shadowRoot.querySelector(
      ".chat-title",
    ) as HTMLElement;
    this.timeline = this.shadowRoot.querySelector(
      ".chat-timeline",
    ) as HTMLElement;
    this.input = this.shadowRoot.querySelector(
      ".text-input",
    ) as HTMLTextAreaElement;
    this.sendBtn = this.shadowRoot.querySelector(
      ".send-btn",
    ) as HTMLButtonElement;
    this.micBtn = this.shadowRoot.querySelector(
      ".mic-btn",
    ) as HTMLButtonElement;
    this.launcherBtn = this.shadowRoot.querySelector(
      ".launcher-button",
    ) as HTMLButtonElement;
    this.loadingOverlay = this.shadowRoot.querySelector(
      ".loading-overlay",
    ) as HTMLElement;
    this.loadingText = this.shadowRoot.querySelector(
      ".loading-text",
    ) as HTMLElement;
    this.inputHelper = this.shadowRoot.querySelector(
      ".input-helper",
    ) as HTMLElement;
    this.widgetFooter = this.shadowRoot.querySelector(
      ".widget-footer",
    ) as HTMLElement;

    this.applyLocaleStrings();
    this.initSocket();
    this.bindEvents();
    this.initSpeechRecognition();
    this.initDragging();
    this.waitForData();
  }

  /**
   * Applies locale-specific UI strings to static elements.
   */
  private applyLocaleStrings() {
    const t = i18n[this.locale];

    this.input.placeholder = t.placeholder;

    if (this.inputHelper) {
      this.inputHelper.textContent = t.inputHelper;
    }

    if (this.loadingText) {
      this.loadingText.textContent = t.loading;
    }

    if (this.widgetFooter) {
      this.widgetFooter.textContent = t.poweredBy;
    }

    // Button titles
    if (this.sendBtn) {
      this.sendBtn.title = t.send;
    }
    if (this.micBtn) {
      this.micBtn.title = t.mic;
    }

    const closeBtn = this.shadowRoot.querySelector(".close-btn") as HTMLButtonElement | null;
    if (closeBtn) {
      closeBtn.title = t.close;
    }
  }

  /**
   * Returns the i18n string for the current locale.
   */
  private t(key: string): string {
    return i18n[this.locale]?.[key] ?? i18n['ja'][key] ?? key;
  }

  private initDragging() {
    const header = this.shadowRoot.querySelector(".chat-header") as HTMLElement;
    const handles = [this.launcherBtn, header];

    const onMouseDown = (e: MouseEvent | TouchEvent) => {
      // Disable dragging on small screens (mobile)
      if (window.innerWidth <= 600) return;

      // Don't drag if clicking buttons inside header/launcher
      const target = e.target as HTMLElement;
      if (
        target.closest("button") &&
        target.closest("button") !== this.launcherBtn
      )
        return;

      this.isDragging = false; // Reset on start
      const clientX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
      const clientY = e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;

      this.dragStartX = clientX;
      this.dragStartY = clientY;

      const rect = this.container.getBoundingClientRect();
      this.containerPosX = rect.left;
      this.containerPosY = rect.top;

      const onMouseMove = (moveEv: MouseEvent | TouchEvent) => {
        const moveX =
          moveEv instanceof MouseEvent ? moveEv.clientX : moveEv.touches[0].clientX;
        const moveY =
          moveEv instanceof MouseEvent ? moveEv.clientY : moveEv.touches[0].clientY;

        const deltaX = moveX - this.dragStartX;
        const deltaY = moveY - this.dragStartY;

        if (!this.isDragging && (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5)) {
          this.isDragging = true;
          // When drag starts, switch to top/left and remove bottom/right constraints
          this.container.style.bottom = "auto";
          this.container.style.right = "auto";
        }

        if (this.isDragging) {
          this.container.style.left = `${this.containerPosX + deltaX}px`;
          this.container.style.top = `${this.containerPosY + deltaY}px`;
        }
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.removeEventListener("touchmove", onMouseMove);
        document.removeEventListener("touchend", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
      document.addEventListener("touchmove", onMouseMove);
      document.addEventListener("touchend", onMouseUp);
    };

    handles.forEach((handle) => {
      handle.addEventListener("mousedown", onMouseDown);
      handle.addEventListener("touchstart", onMouseDown, { passive: true });
    });
  }

  private initAudioContext() {
    if (this.audioContext) return;

    try {
      // @ts-expect-error: webkitAudioContext is for older browsers
      const ContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new ContextClass();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.connect(this.audioContext.destination);
    } catch (e) {
      console.error("[MakaseteAI] Failed to initialize AudioContext:", e);
    }
  }

  private async resumeAudioContext() {
    this.initAudioContext();
    if (this.audioContext && this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  private async waitForData() {
    const t = i18n[this.locale];
    let title = t.defaultTitle;
    let initialMsg = t.defaultGreeting;
    let primaryColor = "";

    try {
      // This endpoint blocks until data is fetched from Sheets on the server
      const healthResponse = await fetch(`${this.serverUrl}/health`);
      if (!healthResponse.ok) {
        console.warn("[MakaseteAI] Failed to verify data readiness");
      }

      // Try to fetch settings
      const settingsResponse = await fetch(`${this.serverUrl}/api/settings`);
      if (settingsResponse.ok) {
        const settingsData = await settingsResponse.json();

        if (settingsData && Array.isArray(settingsData) && settingsData.length > 0) {
          // Check if it's key-value format (has 'key' and 'value' properties)
          if ("key" in settingsData[0] && "value" in settingsData[0]) {
            for (const row of settingsData) {
              const k = normalizeSettingKey(row.key);
              if (k === "chattitle" || k === "title") title = row.value;
              if (k === "initialmessage" || k === "greeting") initialMsg = row.value;
              if (k === "primarycolor" || k === "color") primaryColor = row.value;
            }
          } else {
            // Assume row format (single row with columns as properties)
            const row = settingsData[0];
            // Headers are already snake_cased by the server
            if (row.chat_title || row.title) title = row.chat_title || row.title;
            if (row.initial_message || row.greeting) initialMsg = row.initial_message || row.greeting;
            if (row.primary_color || row.color) primaryColor = row.primary_color || row.color;
          }
        }
      }
    } catch (e) {
      console.error("[MakaseteAI] Error fetching initial data/settings:", e);
    } finally {
      this.chatTitle.textContent = title;
      this.appendMessage("makasete-server", initialMsg);

      if (primaryColor) {
        // Apply dynamic primary color to the shadow host
        const host = this.shadowRoot.host as HTMLElement;
        host.style.setProperty('--primary-color', primaryColor);
      }

      this.loadingOverlay.classList.add("hidden");
    }
  }

  private initSocket() {
    this.socket.on("connect", () => {
      // Socket connected
    });

    this.socket.on("text-chunk", (data: { content: string }) => {
      this.appendMessage("makasete-server", data.content, true);
    });

    this.socket.on(
      "audio-chunk",
      async (data: { type: "text" | "audio"; content: unknown }) => {
        if (data.type === "text") {
          this.appendMessage("makasete-server", data.content as string, true);
        } else if (data.type === "audio") {
          this.handleAudioChunk(data.content);
        }
      },
    );

    this.socket.on("error", (data: { message: string }) => {
      console.error("[MakaseteAI] Server error:", data.message);
      this.appendMessage(
        "makasete-server",
        `${this.t('error')}: ${data.message}`,
      );
    });
  }

  private handleAudioChunk(content: unknown) {
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

    this.audioQueue.push(rawData);
    this.playNextInQueue();
  }

  private async playNextInQueue() {
    if (this.isPlaying || this.audioQueue.length === 0) return;
    if (!this.audioContext) this.initAudioContext();
    if (!this.audioContext) return;

    this.isPlaying = true;
    const rawData = this.audioQueue.shift();

    if (rawData) {
      try {
        // decodeAudioData consumes the buffer, so we pass a slice/copy
        const audioBuffer = await this.audioContext.decodeAudioData(
          rawData.slice(0),
        );

        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        if (this.gainNode) source.connect(this.gainNode);

        this.currentSource = source;

        source.onended = () => {
          if (this.currentSource === source) {
            this.currentSource = null;
            this.isPlaying = false;
            this.playNextInQueue();
          }
        };

        source.start(0);
      } catch (e) {
        console.error("[MakaseteAI] Audio decode/play failed:", e);
        this.isPlaying = false;
        this.playNextInQueue();
      }
    } else {
      this.isPlaying = false;
    }
  }

  private resetAudioState() {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // Source might already be stopped
      }
      this.currentSource = null;
    }
    this.isPlaying = false;
    this.audioQueue = [];
  }

  private sendMessage(isVoice = false) {
    const text = this.input.value.trim();
    if (!text) return;

    const useAudio = isVoice || this.isAudioEnabled;
    this.appendMessage("user", text);
    this.input.value = "";
    this.updateInputActions();
    this.showTypingIndicator();

    if (useAudio) {
      this.resetAudioState();
      this.resumeAudioContext().catch(console.error);
    }

    this.socket.emit("user-input", {
      text,
      isVoiceInput: useAudio,
      locale: this.locale,
    });
  }

  private updateInputActions() {
    const hasText = this.input.value.trim().length > 0;
    this.sendBtn.style.display = hasText ? "flex" : "none";
    this.micBtn.style.display = hasText ? "none" : "flex";
  }

  private bindEvents() {
    this.launcherBtn.addEventListener("click", () => {
      if (this.isDragging) return; // Prevent toggle if dragging
      const isOpen = this.chatWindow.classList.toggle("open");

      // Prevent body scrolling when open on mobile
      if (window.innerWidth <= 600) {
        document.body.style.overflow = isOpen ? "hidden" : "";
      }

      if (isOpen) {
        this.resumeAudioContext().catch(console.error);
      } else {
        this.resetAudioState();
      }
    });

    this.sendBtn.addEventListener("click", () => {
      this.resumeAudioContext().catch(console.error);
      this.sendMessage();
    });

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.resumeAudioContext().catch(console.error);
        this.sendMessage();
      }
    });

    this.micBtn.addEventListener("click", () => {
      this.resumeAudioContext().catch(console.error);
      this.toggleRecording();
    });

    this.input.addEventListener("input", () => {
      this.updateInputActions();
    });

    const closeBtn = this.shadowRoot.querySelector(".close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        this.chatWindow.classList.remove("open");
        document.body.style.overflow = ""; // Ensure scroll is restored
        this.resetAudioState();
      });
    }
  }

  private initSpeechRecognition() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      this.recognition = recognition;

      // Set recognition language based on locale
      const recognitionLangMap: Record<Locale, string> = {
        'ja': 'ja-JP',
        'en': 'en-US',
        'zh-CN': 'zh-CN',
      };
      recognition.lang = recognitionLangMap[this.locale] ?? 'ja-JP';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const text = event.results[0][0].transcript;
        this.input.value = text;
        this.resumeAudioContext().catch(console.error);
        this.sendMessage(true);
      };

      recognition.onend = () => {
        this.isRecording = false;
        this.micBtn.classList.remove("recording");
      };
    } else {
      console.warn("Speech Recognition not supported");
      this.micBtn.style.display = "none";
    }
  }

  private toggleRecording() {
    if (!this.recognition) return;

    if (this.isRecording) {
      this.recognition.stop();
    } else {
      this.recognition.start();
      this.isRecording = true;
      this.micBtn.classList.add("recording");
    }
  }

  private currentMakaseteServerMessageRaw: string = "";

  private appendMessage(
    role: "user" | "makasete-server",
    text: string,
    appendToLast = false,
  ) {
    if (role === "makasete-server") {
      this.hideTypingIndicator();
    }

    if (appendToLast && role === "makasete-server") {
      const lastMsg = this.timeline.lastElementChild;
      if (lastMsg && lastMsg.classList.contains("makasete-server")) {
        this.currentMakaseteServerMessageRaw += text;
        lastMsg.innerHTML = formatMessageText(this.currentMakaseteServerMessageRaw);
        this.scrollToBottom();
        return;
      }
    }

    if (role === "makasete-server") {
      this.currentMakaseteServerMessageRaw = text;
    }

    const div = document.createElement("div");
    div.className = `message ${role}`;
    div.innerHTML = formatMessageText(text);
    this.timeline.appendChild(div);
    this.scrollToBottom();
  }

  private showTypingIndicator() {
    if (this.timeline.querySelector(".typing-indicator")) return;
    const div = document.createElement("div");
    div.className = "typing-indicator";
    div.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        `;
    this.timeline.appendChild(div);
    this.scrollToBottom();
  }

  private hideTypingIndicator() {
    const indicator = this.timeline.querySelector(".typing-indicator");
    if (indicator) {
      indicator.remove();
    }
  }

  private scrollToBottom() {
    requestAnimationFrame(() => {
      this.timeline.scrollTop = this.timeline.scrollHeight;
    });
  }
}
