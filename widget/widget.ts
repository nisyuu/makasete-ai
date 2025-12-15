import { io, Socket } from 'socket.io-client';

export class ChatWidget {
    private shadowRoot: ShadowRoot;
    private socket: Socket;
    private mediaSource: MediaSource | null = null;
    private sourceBuffer: SourceBuffer | null = null;
    private audioQueue: ArrayBuffer[] = [];
    private isPlaying = false;
    private audioElement: HTMLAudioElement;

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
    private recognition: any = null; // Web Speech API

    constructor(shadowRoot: ShadowRoot, serverUrl: string) {
        this.shadowRoot = shadowRoot;
        this.socket = io(serverUrl);

        // Element binding
        this.chatWindow = this.shadowRoot.querySelector('.chat-window') as HTMLElement;
        this.timeline = this.shadowRoot.querySelector('.chat-timeline') as HTMLElement;
        this.input = this.shadowRoot.querySelector('.text-input') as HTMLTextAreaElement;
        this.sendBtn = this.shadowRoot.querySelector('.send-btn') as HTMLButtonElement;
        this.micBtn = this.shadowRoot.querySelector('.mic-btn') as HTMLButtonElement;
        this.launcherBtn = this.shadowRoot.querySelector('.launcher-button') as HTMLButtonElement;
        this.audioToggleBtn = this.shadowRoot.querySelector('.audio-toggle-btn') as HTMLButtonElement;

        // Load persisted state
        const savedAudioState = localStorage.getItem('ec_voice_audio_enabled');
        if (savedAudioState === 'true') {
            this.isAudioEnabled = true;
            this.updateAudioToggleUI();
        }

        // Audio Element (invisible)
        this.audioElement = document.createElement('audio');
        this.shadowRoot.appendChild(this.audioElement);

        this.initSocket();
        this.bindEvents();
        this.initSpeechRecognition();

        // Initial Greeting
        this.appendMessage('bot', 'いらっしゃいませ。AI書店員の福蔵です。何かお探しの本はございますか？');
    }
    private initSocket() {
        this.socket.on('connect', () => {
            console.log('Connected to server');
        });

        this.socket.on('text-chunk', (data: { content: string }) => {
            this.appendMessage('bot', data.content, true);
        });

        this.socket.on('audio-chunk', (data: { type: 'text' | 'audio', content: any }) => {
            if (data.type === 'text') {
                this.appendMessage('bot', data.content, true);
            } else if (data.type === 'audio') {
                this.handleAudioChunk(data.content);
            }
        });

        this.socket.on('response-complete', () => {
            // End of turn
        });

        this.socket.on('error', (data: { message: string }) => {
            console.error("Server Error:", data.message);
            this.appendMessage('bot', `エラーが発生しました: ${data.message}`);
        });
    }

    // ...

    // ...

    // ...

    private sendMessage(isVoice = false) {
        const text = this.input.value.trim();
        if (!text) return;

        this.appendMessage('user', text);
        this.input.value = '';

        // Show typing indicator
        this.showTypingIndicator();

        // Send message with audio preference
        this.socket.emit('user-input', { text, isVoiceInput: this.isAudioEnabled });
    }

    private bindEvents() {
        this.launcherBtn.addEventListener('click', () => {
            this.chatWindow.classList.toggle('open');
            if (this.chatWindow.classList.contains('open')) {
                // Initialize audio context/source on user interaction to unlock autoplay policies
                this.initAudioContext();
            }
        });

        this.sendBtn.addEventListener('click', () => this.sendMessage());

        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault(); // Prevent newline insertion on send
                this.sendMessage();
            }
        });

        this.micBtn.addEventListener('click', () => this.toggleRecording());

        this.shadowRoot.querySelector('.close-btn')?.addEventListener('click', () => {
            this.chatWindow.classList.remove('open');
        });

        this.audioToggleBtn.addEventListener('click', () => {
            this.isAudioEnabled = !this.isAudioEnabled;
            localStorage.setItem('ec_voice_audio_enabled', String(this.isAudioEnabled));
            this.updateAudioToggleUI();

            // Note: If turning ON, we might want to check/resume context, but usually it's fine until next play.
            if (this.isAudioEnabled) {
                this.initAudioContext();
            }
        });
    }

    private updateAudioToggleUI() {
        const iconSpan = this.audioToggleBtn.querySelector('.audio-icon');
        const textSpan = this.audioToggleBtn.querySelector('.audio-text');

        if (this.isAudioEnabled) {
            if (iconSpan) iconSpan.textContent = '🔊';
            if (textSpan) textSpan.textContent = '音声: ON';
            this.audioToggleBtn.title = '音声読み上げON';
        } else {
            if (iconSpan) iconSpan.textContent = '🔇';
            if (textSpan) textSpan.textContent = '音声: OFF';
            this.audioToggleBtn.title = '音声読み上げOFF';
        }
    }

    private initAudioContext() {
        if (this.mediaSource) return; // Already initialized

        this.mediaSource = new MediaSource();
        this.audioElement.src = URL.createObjectURL(this.mediaSource);

        this.mediaSource.addEventListener('sourceopen', () => {
            // For MP3. Note: not all browsers support 'audio/mpeg' in MediaSource (e.g. Firefox might need configuration, Chrome is usually ok).
            // If issues arise, consider 'audio/mp4; codecs="mp4a.40.2"' but re-encoding might be needed.
            // Chrome supports audio/mpeg.
            try {
                this.sourceBuffer = this.mediaSource!.addSourceBuffer('audio/mpeg');
                this.sourceBuffer.addEventListener('updateend', () => {
                    this.processAudioQueue();
                });
            } catch (e) {
                console.error("MediaSource addSourceBuffer error", e);
            }
        });

        this.mediaSource.addEventListener('sourceclose', () => {
            console.warn("MediaSource closed");
        });
        this.mediaSource.addEventListener('error', (e) => {
            console.error("MediaSource error", e);
        });
    }

    private handleAudioChunk(content: ArrayBuffer | string) {

        // If content is pure buffer
        this.audioQueue.push(content as ArrayBuffer);
        this.processAudioQueue();

        // Attempt play
        this.playAudio();
    }

    private processAudioQueue() {
        if (!this.sourceBuffer || this.sourceBuffer.updating || this.audioQueue.length === 0) {
            return;
        }

        const chunk = this.audioQueue.shift();
        if (chunk) {
            try {
                this.sourceBuffer.appendBuffer(chunk);
            } catch (e) {
                console.error("AppendBuffer Error", e);
            }
        }
    }

    private playAudio() {
        if (this.audioElement.paused) {
            this.audioElement.play()
                .then(() => {
                    this.isPlaying = true;
                })
                .catch(e => {
                    console.error("Auto-play prevented (User interaction required?)", e);
                    // Try resuming context if web audio API was used (not here, but good practice)
                });
        }
    }

    private initSpeechRecognition() {
        // @ts-ignore
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            this.recognition = new SpeechRecognition();
            this.recognition.lang = 'ja-JP';
            this.recognition.continuous = false;
            this.recognition.interimResults = false;

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
            let safeText = rawText
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            return safeText.replace(/\[((?:[^\[\]]|\[[^\]]*\])+)\]\(([^)]+)\)/g, (match, linkText, url) => {
                return `<a href="${url}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
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
