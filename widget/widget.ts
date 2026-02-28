import { io, Socket } from 'socket.io-client';

export class ChatWidget {
    private shadowRoot: ShadowRoot;
    private socket: Socket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private mediaSource: MediaSource | any;
    private sourceBuffer: SourceBuffer | null = null;
    private audioQueue: ArrayBuffer[] = [];
    private isSourceOpen = false;
    private audio: HTMLAudioElement;
    private isIOS = false; // Add flag for iOS detection

    // UI Elements
    private chatWindow: HTMLElement;
    private timeline: HTMLElement;
    private input: HTMLTextAreaElement;
    private sendBtn: HTMLButtonElement;
    private micBtn: HTMLButtonElement;
    private launcherBtn: HTMLButtonElement;
    private audioToggleBtn: HTMLButtonElement;

    // State
    private isRecording = false;
    private isAudioEnabled = false; // Default OFF
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private recognition: any = null; // Web Speech API

    constructor(shadowRoot: ShadowRoot, serverUrl: string) {
        this.shadowRoot = shadowRoot;
        console.log('[MakaseteBot] Connecting to:', serverUrl);
        this.socket = io(serverUrl);

        // Element binding
        this.chatWindow = this.shadowRoot.querySelector('.chat-window') as HTMLElement;
        this.timeline = this.shadowRoot.querySelector('.chat-timeline') as HTMLElement;
        this.input = this.shadowRoot.querySelector('.text-input') as HTMLTextAreaElement;
        this.sendBtn = this.shadowRoot.querySelector('.send-btn') as HTMLButtonElement;
        this.micBtn = this.shadowRoot.querySelector('.mic-btn') as HTMLButtonElement;
        this.launcherBtn = this.shadowRoot.querySelector('.launcher-button') as HTMLButtonElement;
        this.audioToggleBtn = this.shadowRoot.querySelector('.audio-toggle-btn') as HTMLButtonElement;

        // Detect iOS and Safari (both need fMP4 for MSE)
        const ua = navigator.userAgent;
        this.isIOS = /iPhone|iPad|iPod/i.test(ua) || 
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
                     (/^((?!chrome|android).)*safari/i.test(ua));
        
        console.log('[MakaseteBot] Device info:', { isIOS: this.isIOS, ua });

        this.audio = new Audio();
        this.audio.disableRemotePlayback = true;
        
        this.initSocket();
        this.bindEvents();
        this.initSpeechRecognition();
        this.updateAudioToggleUI();
        
        // Initial Greeting
        this.appendMessage('bot', 'いらっしゃいませ。AI書店員の福蔵です。何かお探しの本はございますか？');
    }

    private initSocket() {
        this.socket.on('connect', () => {
            console.log('[MakaseteBot] Connected to server. ID:', this.socket.id);
        });

        this.socket.on('text-chunk', (data: { content: string }) => {
            this.appendMessage('bot', data.content, true);
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.socket.on('audio-chunk', (data: { type: 'text' | 'audio', content: any }) => {
            if (data.type === 'text') {
                console.log('[MakaseteBot] New sentence started:', data.content);
                this.appendMessage('bot', data.content, true);
                
                // Each new sentence is a fresh fMP4 stream. Reset to accept new header.
                if (this.isAudioEnabled) {
                    this.resetAudio();
                    this.initAudio();
                    this.audio.play().catch(() => {});
                }
            } else if (data.type === 'audio') {
                this.handleAudioChunk(data.content);
            }
        });

        this.socket.on('response-complete', (data) => {
            console.log('[MakaseteBot] Response complete:', data);
        });

        this.socket.on('error', (data: { message: string }) => {
            console.error("[MakaseteBot] Server Error:", data.message);
            this.appendMessage('bot', `エラーが発生しました: ${data.message}`);
        });
    }

    private sendMessage(isVoice = false) {
        const text = this.input.value.trim();
        if (!text) return;

        const useAudio = isVoice || this.isAudioEnabled;
        console.log('[MakaseteBot] Sending message. Audio Enabled:', useAudio);

        this.appendMessage('user', text);
        this.input.value = '';
        this.showTypingIndicator();

        this.socket.emit('user-input', {
            text,
            isVoiceInput: useAudio,
            isIOS: this.isIOS
        });
    }

    private resetAudio() {
        console.log('[MakaseteBot] Resetting audio state');
        this.audioQueue = [];
        this.isSourceOpen = false;
        this.sourceBuffer = null;
        if (this.audio.src) {
            URL.revokeObjectURL(this.audio.src);
            this.audio.src = '';
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const MediaSourceClass = window.MediaSource || (window as any).ManagedMediaSource;
        if (MediaSourceClass) {
            this.mediaSource = new MediaSourceClass();
        }
    }

    private initAudio() {
        if (!this.mediaSource || this.audio.src) return;

        this.audio.src = URL.createObjectURL(this.mediaSource);
        const ms = this.mediaSource;

        ms.addEventListener('sourceopen', () => {
            console.log('[MakaseteBot] MediaSource opened');
            this.isSourceOpen = true;
            const mimeType = 'audio/mp4; codecs="mp4a.40.2"';

            try {
                const sb = ms.addSourceBuffer(mimeType);
                sb.mode = 'sequence';
                this.sourceBuffer = sb;
                sb.addEventListener('updateend', () => this.processAudioQueue());
                sb.addEventListener('error', (e: Event) => console.error('[MakaseteBot] SourceBuffer error:', e));
                this.processAudioQueue();
            } catch (e) {
                console.error('[MakaseteBot] AddSourceBuffer failed:', e);
            }
        });
    }

    private handleAudioChunk(content: any) {
        // Convert various binary formats to ArrayBuffer
        let buffer: ArrayBuffer;
        
        if (content instanceof ArrayBuffer) {
            buffer = content;
        } else if (content instanceof Uint8Array || ArrayBuffer.isView(content)) {
            buffer = content.buffer;
        } else if (typeof content === 'object' && content !== null && content.type === 'Buffer') {
            // Handle Socket.io Buffer serialization
            buffer = new Uint8Array(content.data).buffer;
        } else {
            console.warn('[MakaseteBot] Unknown audio data format:', typeof content);
            return;
        }

        this.audioQueue.push(buffer);
        this.processAudioQueue();
    }

    private processAudioQueue() {
        if (this.audioQueue.length > 0 && this.sourceBuffer && !this.sourceBuffer.updating && this.isSourceOpen) {
            const chunk = this.audioQueue.shift();
            if (chunk) {
                try {
                    this.sourceBuffer.appendBuffer(chunk);
                } catch (e) {
                    console.error('[MakaseteBot] Append buffer error:', e);
                }
            }
        }
    }

    private bindEvents() {
        this.launcherBtn.addEventListener('click', () => {
            this.chatWindow.classList.toggle('open');
            if (this.chatWindow.classList.contains('open')) {
                // Initialize audio on user interaction to unlock autoplay policies
                this.resetAudio();
                this.initAudio();
                this.audio.play().catch(e => console.log('[MakaseteBot] Autoplay priming error:', e));
            }
        });

        this.sendBtn.addEventListener('click', () => this.sendMessage());

        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        this.micBtn.addEventListener('click', () => this.toggleRecording());

        const closeBtn = this.shadowRoot.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.chatWindow.classList.remove('open');
            });
        }

        this.audioToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.isAudioEnabled = !this.isAudioEnabled;
            console.log('[MakaseteBot] Audio toggle clicked. New state:', this.isAudioEnabled);
            this.updateAudioToggleUI();

            if (this.isAudioEnabled) {
                this.resetAudio();
                this.initAudio();
                this.audio.play()
                    .then(() => console.log('[MakaseteBot] Audio playback primed successfully'))
                    .catch(err => console.warn('[MakaseteBot] Audio prime failed:', err));
            }
        });
    }

    private updateAudioToggleUI() {
        const iconSpan = this.audioToggleBtn.querySelector('.audio-icon');
        const textSpan = this.audioToggleBtn.querySelector('.audio-text');

        if (this.isAudioEnabled) {
            if (iconSpan) iconSpan.textContent = '🔊';
            if (textSpan) textSpan.textContent = '音声: ON';
            this.audioToggleBtn.title = '音声読み上げをOFFにする';
        } else {
            if (iconSpan) iconSpan.textContent = '🔇';
            if (textSpan) textSpan.textContent = '音声: OFF';
            this.audioToggleBtn.title = '音声読み上げをONにする';
        }
    }

    private initSpeechRecognition() {
        // @ts-expect-error: SpeechRecognition might not be in window
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.recognition = new SpeechRecognition();
            this.recognition.lang = 'ja-JP';
            this.recognition.continuous = false;
            this.recognition.interimResults = false;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.recognition.onresult = (event: any) => {
                const text = event.results[0][0].transcript;
                this.input.value = text;
                this.sendMessage(true); // Auto send as voice input
            };

            this.recognition.onend = () => {
                this.isRecording = false;
                this.micBtn.classList.remove('recording');
            };
        } else {
            console.warn("Speech Recognition not supported");
            this.micBtn.style.display = 'none';
        }
    }

    private toggleRecording() {
        if (!this.recognition) return;

        if (this.isRecording) {
            this.recognition.stop();
        } else {
            this.recognition.start();
            this.isRecording = true;
            this.micBtn.classList.add('recording');
        }
    }

    private currentBotMessageRaw: string = "";

    private appendMessage(role: 'user' | 'bot', text: string, appendToLast = false) {
        // Ensure typing indicator is removed before showing bot response
        if (role === 'bot') {
            this.hideTypingIndicator();
        }

        // Helper to format text with links
        const formatText = (rawText: string) => {
            // Regex to match [text](url)
            // We escape HTML characters first to prevent XSS from raw text, then replace markdown links
            const safeText = rawText
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            return safeText.replace(/\[((?:[^[\]]|\[[^\]]*\])+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
                // Security: Basic URL sanitization to prevent javascript: pseudo-protocol XSS
                const isSafeUrl = /^(https?:\/\/|\/)/i.test(url.trim());
                const finalUrl = isSafeUrl ? url.trim() : '#';
                return `<a href="${finalUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
            });
        };

        // If appendToLast is true and last message is from bot, append text
        if (appendToLast && role === 'bot') {
            const lastMsg = this.timeline.lastElementChild;
            if (lastMsg && lastMsg.classList.contains('bot')) {
                // Buffer the new text
                this.currentBotMessageRaw += text;
                // Re-render the full message
                const newHtml = formatText(this.currentBotMessageRaw);
                lastMsg.innerHTML = newHtml;
                this.scrollToBottom();
                return;
            }
        }

        // New message
        if (role === 'bot') {
            this.currentBotMessageRaw = text;
        }

        const div = document.createElement('div');
        div.className = `message ${role}`;
        div.innerHTML = formatText(text); // Use innerHTML to render <a> tags
        this.timeline.appendChild(div);
        this.scrollToBottom();
    }

    private showTypingIndicator() {
        // Prevent duplicate indicators
        if (this.timeline.querySelector('.typing-indicator')) return;

        const div = document.createElement('div');
        div.className = 'typing-indicator';
        div.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        `;
        this.timeline.appendChild(div);
        this.scrollToBottom();
    }

    private hideTypingIndicator() {
        const indicator = this.timeline.querySelector('.typing-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    private scrollToBottom() {
        this.timeline.scrollTop = this.timeline.scrollHeight;
    }
}
