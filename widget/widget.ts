import { io, Socket } from 'socket.io-client';

interface AudioWithTimeout extends HTMLAudioElement {
    _playTimeout?: NodeJS.Timeout | null;
}

export class ChatWidget {
    private shadowRoot: ShadowRoot;
    private socket: Socket;
    private audioQueue: Blob[] = [];
    private isPlaying = false;
    private audio: AudioWithTimeout;

    // UI Elements
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
    private isAudioEnabled = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private recognition: any = null;
    private serverUrl: string;

    constructor(shadowRoot: ShadowRoot, serverUrl: string) {
        this.shadowRoot = shadowRoot;
        this.serverUrl = serverUrl;
        this.socket = io(serverUrl);

        // Element binding
        this.chatWindow = this.shadowRoot.querySelector('.chat-window') as HTMLElement;
        this.timeline = this.shadowRoot.querySelector('.chat-timeline') as HTMLElement;
        this.input = this.shadowRoot.querySelector('.text-input') as HTMLTextAreaElement;
        this.sendBtn = this.shadowRoot.querySelector('.send-btn') as HTMLButtonElement;
        this.micBtn = this.shadowRoot.querySelector('.mic-btn') as HTMLButtonElement;
        this.launcherBtn = this.shadowRoot.querySelector('.launcher-button') as HTMLButtonElement;
        this.audioToggleBtn = this.shadowRoot.querySelector('.audio-toggle-btn') as HTMLButtonElement;
        this.loadingOverlay = this.shadowRoot.querySelector('.loading-overlay') as HTMLElement;

        this.audio = new Audio();
        this.audio.addEventListener('ended', () => this.onAudioEnded());
        
        this.initSocket();
        this.bindEvents();
        this.initSpeechRecognition();
        this.updateAudioToggleUI();
        this.waitForData();
        
        this.appendMessage('bot', 'いらっしゃいませ。AI店員です。何かお手伝いできることはありますか？');
    }

    private async waitForData() {
        try {
            // This endpoint now blocks until data is fetched from Sheets on the server
            const response = await fetch(`${this.serverUrl}/health`);
            if (response.ok) {
                this.loadingOverlay.classList.add('hidden');
            } else {
                console.warn("[MakaseteBot] Failed to verify data readiness");
                // Optional: show error in overlay
            }
        } catch (e) {
            console.error("[MakaseteBot] Error waiting for data:", e);
        }
    }

    private initSocket() {
        this.socket.on('connect', () => {
            // Socket connected
        });

        this.socket.on('text-chunk', (data: { content: string }) => {
            this.appendMessage('bot', data.content, true);
        });

        this.socket.on('audio-chunk', async (data: { type: 'text' | 'audio', content: unknown }) => {
            if (data.type === 'text') {
                this.appendMessage('bot', data.content as string, true);
            } else if (data.type === 'audio') {
                this.handleAudioChunk(data.content);
            }
        });

        this.socket.on('error', (data: { message: string }) => {
            console.error("[MakaseteBot] Server error:", data.message);
            this.appendMessage('bot', `エラーが発生しました: ${data.message}`);
        });
    }

    private handleAudioChunk(content: unknown) {
        if (!this.isAudioEnabled) return;

        let rawData: ArrayBufferLike;
        if (content instanceof ArrayBuffer) {
            rawData = content;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } else if (content && typeof content === 'object' && 'data' in content && (content as any).type === 'Buffer') {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            rawData = new Uint8Array((content as any).data).buffer;
        } else if (content instanceof Uint8Array) {
            rawData = content.buffer;
        } else {
            console.warn('[MakaseteBot] Unexpected audio format');
            return;
        }

        const blob = new Blob([rawData as ArrayBuffer], { type: 'audio/mpeg' });
        this.audioQueue.push(blob);
        this.playNextInQueue();
    }

    private playNextInQueue() {
        if (this.isPlaying || this.audioQueue.length === 0) return;

        this.isPlaying = true;
        const nextBlob = this.audioQueue.shift();
        if (nextBlob) {
            if (this.audio.src) {
                URL.revokeObjectURL(this.audio.src);
            }
            this.audio.src = URL.createObjectURL(nextBlob);
            
            // Safety timeout: If audio doesn't start/end within 15s, force next
            const timeout = setTimeout(() => {
                if (this.isPlaying) {
                    console.warn('[MakaseteBot] Audio playback timed out');
                    this.onAudioEnded();
                }
            }, 15000);

            this.audio.play()
                .then(() => {
                    // Play started
                })
                .catch(e => {
                    console.warn('[MakaseteBot] Play failed:', e);
                    clearTimeout(timeout);
                    this.onAudioEnded();
                });

            // Store timeout ID to clear it when audio actually ends
            this.audio._playTimeout = timeout;
        }
    }

    private onAudioEnded() {
        if (this.audio._playTimeout) {
            clearTimeout(this.audio._playTimeout);
            this.audio._playTimeout = null;
        }
        this.isPlaying = false;
        this.playNextInQueue();
    }

    private resetAudioState() {
        this.audio.pause();
        this.isPlaying = false;
        this.audioQueue = [];
        if (this.audio.src) {
            URL.revokeObjectURL(this.audio.src);
            this.audio.src = '';
        }
        if (this.audio._playTimeout) {
            clearTimeout(this.audio._playTimeout);
            this.audio._playTimeout = null;
        }
    }

    private sendMessage(isVoice = false) {
        const text = this.input.value.trim();
        if (!text) return;

        const useAudio = isVoice || this.isAudioEnabled;
        this.appendMessage('user', text);
        this.input.value = '';
        this.showTypingIndicator();

        if (useAudio) {
            this.resetAudioState();
            // Unlock audio element
            this.audio.play().catch(() => {});
        }

        this.socket.emit('user-input', {
            text,
            isVoiceInput: useAudio
        });
    }

    private bindEvents() {
        this.launcherBtn.addEventListener('click', () => {
            const isOpen = this.chatWindow.classList.toggle('open');
            if (isOpen) {
                this.audio.play().catch(() => {});
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
            this.updateAudioToggleUI();
            
            this.resetAudioState();
            if (this.isAudioEnabled) {
                this.audio.play().catch(() => {});
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
                this.sendMessage(true);
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
        if (role === 'bot') {
            this.hideTypingIndicator();
        }

        const formatText = (rawText: string) => {
            // 1. Escape HTML to prevent basic XSS
            const escapeHtml = (str: string) => {
                return str.replace(/[&<>"']/g, (m) => ({
                    '&': '&amp;',
                    '<': '&lt;',
                    '>': '&gt;',
                    '"': '&quot;',
                    "'": '&#39;'
                }[m] || m));
            };

            // 2. Safe URL check for Markdown links
            // Only allow http, https, and relative paths. Block javascript:, etc.
            const sanitizeUrl = (url: string) => {
                const trimmed = url.trim();
                if (/^(https?:\/\/|\/)/i.test(trimmed)) {
                    return trimmed;
                }
                return '#';
            };

            // First, escape the entire text
            const escapedText = escapeHtml(rawText);

            // Then, selectively allow Markdown links [text](url)
            // Note: We use a regex that matches the escaped brackets/parens if necessary, 
            // but since we escaped the whole text first, we need to match the literal chars.
            return escapedText.replace(/\[((?:[^[\]]|\[[^\]]*\])+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
                const safeUrl = sanitizeUrl(url);
                return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a>`;
            });
        };

        if (appendToLast && role === 'bot') {
            const lastMsg = this.timeline.lastElementChild;
            if (lastMsg && lastMsg.classList.contains('bot')) {
                this.currentBotMessageRaw += text;
                lastMsg.innerHTML = formatText(this.currentBotMessageRaw);
                this.scrollToBottom();
                return;
            }
        }

        if (role === 'bot') {
            this.currentBotMessageRaw = text;
        }

        const div = document.createElement('div');
        div.className = `message ${role}`;
        div.innerHTML = formatText(text);
        this.timeline.appendChild(div);
        this.scrollToBottom();
    }

    private showTypingIndicator() {
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
        requestAnimationFrame(() => {
            this.timeline.scrollTop = this.timeline.scrollHeight;
        });
    }
}
