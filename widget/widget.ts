import { io, Socket } from "socket.io-client";

interface BufferData {
  type: "Buffer";
  data: number[];
}

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
  private timeline: HTMLElement;
  private input: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private micBtn: HTMLButtonElement;
  private launcherBtn: HTMLButtonElement;
  private audioToggleBtn: HTMLButtonElement;
  private loadingOverlay: HTMLElement;

  // State
  private isRecording = false;
  private isAudioEnabled = false;
  private recognition: SpeechRecognition | null = null;
  private serverUrl: string;

  // Dragging state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private containerPosX = 0;
  private containerPosY = 0;

  constructor(shadowRoot: ShadowRoot, serverUrl: string) {
    this.shadowRoot = shadowRoot;
    this.serverUrl = serverUrl;
    this.socket = io(serverUrl);

    // Element binding
    this.container = this.shadowRoot.querySelector(
      ".widget-container",
    ) as HTMLElement;
    this.chatWindow = this.shadowRoot.querySelector(
      ".chat-window",
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
    this.audioToggleBtn = this.shadowRoot.querySelector(
      ".audio-toggle-btn",
    ) as HTMLButtonElement;
    this.loadingOverlay = this.shadowRoot.querySelector(
      ".loading-overlay",
    ) as HTMLElement;

    this.initSocket();
    this.bindEvents();
    this.initSpeechRecognition();
    this.initDragging();
    this.updateAudioToggleUI();
    this.waitForData();

    this.appendMessage(
      "makasete-server",
      "AIアシスタントです。何かお手伝いできることはありますか？",
    );
  }

  private initDragging() {
    const header = this.shadowRoot.querySelector(".chat-header") as HTMLElement;
    const handles = [this.launcherBtn, header];

    const onMouseDown = (e: MouseEvent | TouchEvent) => {
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

        // Optional: snap to viewport edges if needed
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
    try {
      // This endpoint now blocks until data is fetched from Sheets on the server
      const response = await fetch(`${this.serverUrl}/health`);
      if (response.ok) {
        this.loadingOverlay.classList.add("hidden");
      } else {
        console.warn("[MakaseteAI] Failed to verify data readiness");
        // Optional: show error in overlay
      }
    } catch (e) {
      console.error("[MakaseteAI] Error waiting for data:", e);
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
        `エラーが発生しました: ${data.message}`,
      );
    });
  }

  private handleAudioChunk(content: unknown) {
    if (!this.isAudioEnabled) return;

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
    this.showTypingIndicator();

    if (useAudio) {
      this.resetAudioState();
      this.resumeAudioContext().catch(console.error);
    }

    this.socket.emit("user-input", {
      text,
      isVoiceInput: useAudio,
    });
  }

  private bindEvents() {
    this.launcherBtn.addEventListener("click", () => {
      if (this.isDragging) return; // Prevent toggle if dragging
      const isOpen = this.chatWindow.classList.toggle("open");
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

    const closeBtn = this.shadowRoot.querySelector(".close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        this.chatWindow.classList.remove("open");
        this.resetAudioState();
      });
    }

    this.audioToggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.isAudioEnabled = !this.isAudioEnabled;
      this.updateAudioToggleUI();

      this.resetAudioState();
      if (this.isAudioEnabled) {
        this.resumeAudioContext().catch(console.error);
      }
    });
  }

  private updateAudioToggleUI() {
    const iconSpan = this.audioToggleBtn.querySelector(".audio-icon");
    const textSpan = this.audioToggleBtn.querySelector(".audio-text");

    if (this.isAudioEnabled) {
      if (iconSpan) iconSpan.textContent = "🔊";
      if (textSpan) textSpan.textContent = "音声: ON";
      this.audioToggleBtn.title = "音声読み上げをOFFにする";
    } else {
      if (iconSpan) iconSpan.textContent = "🔇";
      if (textSpan) textSpan.textContent = "音声: OFF";
      this.audioToggleBtn.title = "音声読み上げをONにする";
    }
  }

  private initSpeechRecognition() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      this.recognition = recognition;
      recognition.lang = "ja-JP";
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

    const formatText = (rawText: string) => {
      // 1. Escape HTML to prevent basic XSS
      const escapeHtml = (str: string) => {
        return str.replace(
          /[&<>"']/g,
          (m) =>
            ({
              "&": "&amp;",
              "<": "&lt;",
              ">": "&gt;",
              '"': "&quot;",
              "'": "&#39;",
            })[m] || m,
        );
      };

      // 2. Safe URL check for Markdown links
      // Only allow http, https, and relative paths. Block javascript:, etc.
      const sanitizeUrl = (url: string) => {
        const trimmed = url.trim();
        if (/^(https?:\/\/|\/)/i.test(trimmed)) {
          return trimmed;
        }
        return "#";
      };

      // First, escape the entire text
      const escapedText = escapeHtml(rawText);

      // Then, selectively allow Markdown links [text](url)
      // Note: We use a regex that matches the escaped brackets/parens if necessary,
      // but since we escaped the whole text first, we need to match the literal chars.
      return escapedText.replace(
        /\[((?:[^[\]]|\[[^\]]*\])+)\]\(([^)]+)\)/g,
        (_match, linkText, url) => {
          const safeUrl = sanitizeUrl(url);
          return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
        },
      );
    };

    if (appendToLast && role === "makasete-server") {
      const lastMsg = this.timeline.lastElementChild;
      if (lastMsg && lastMsg.classList.contains("makasete-server")) {
        this.currentMakaseteServerMessageRaw += text;
        lastMsg.innerHTML = formatText(this.currentMakaseteServerMessageRaw);
        this.scrollToBottom();
        return;
      }
    }

    if (role === "makasete-server") {
      this.currentMakaseteServerMessageRaw = text;
    }

    const div = document.createElement("div");
    div.className = `message ${role}`;
    div.innerHTML = formatText(text);
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
