// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface CapturedSocketOpts {
    serverUrl: string;
    onTextChunk: (content: string) => void;
    onAudioChunk: (data: { type: 'text' | 'audio'; content: unknown }) => void;
    onError: (message: string) => void;
    onConnect?: () => void;
    onResponseComplete?: () => void;
}
interface CapturedAudioOpts {
    onTranscript: (text: string) => void;
    onRecordingEnd: (finalText: string) => void;
    language?: string;
}

const captured: {
    socketOpts?: CapturedSocketOpts;
    audioOpts?: CapturedAudioOpts;
} = {};

const socketHandler = {
    sendUserInput: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(() => true),
};
const audioHandler = {
    handleAudioChunk: vi.fn(),
    initAudioContext: vi.fn(),
    resumeAudioContext: vi.fn(() => Promise.resolve()),
    resetAudioState: vi.fn(),
    toggleRecording: vi.fn(),
    isSpeechRecognitionSupported: vi.fn(() => true),
    cleanup: vi.fn(),
};

vi.mock('./utils/socketHandler', () => ({
    initSocketHandler: vi.fn((opts: CapturedSocketOpts) => {
        captured.socketOpts = opts;
        return socketHandler;
    }),
}));
vi.mock('./utils/audioHandler', () => ({
    initAudioHandler: vi.fn((opts: CapturedAudioOpts) => {
        captured.audioOpts = opts;
        return audioHandler;
    }),
}));

import { initChatWidget } from './widget';

function getEls() {
    const host = document.getElementById('makasete-ai-widget-host')!;
    const shadow = host.shadowRoot!;
    return {
        shadow,
        container: shadow.querySelector('.widget-container') as HTMLElement,
        chatWindow: shadow.querySelector('.chat-window') as HTMLElement,
        chatTitle: shadow.querySelector('.chat-title') as HTMLElement,
        header: shadow.querySelector('.chat-header') as HTMLElement,
        timeline: shadow.querySelector('.chat-timeline') as HTMLElement,
        input: shadow.querySelector('.text-input') as HTMLTextAreaElement,
        sendBtn: shadow.querySelector('.send-btn') as HTMLButtonElement,
        micBtn: shadow.querySelector('.mic-btn') as HTMLButtonElement,
        launcherBtn: shadow.querySelector('.launcher-button') as HTMLButtonElement,
        closeBtn: shadow.querySelector('.close-btn') as HTMLButtonElement,
        loadingOverlay: shadow.querySelector('.loading-overlay') as HTMLElement,
    };
}

describe('initChatWidget (rich UI)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        document.body.style.overflow = '';
        vi.clearAllMocks();
        audioHandler.isSpeechRecognitionSupported.mockReturnValue(true);
        audioHandler.resumeAudioContext.mockReturnValue(Promise.resolve());
        window.alert = vi.fn();
        // fetch(/health) はローディング解除に使われる
        vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true } as Response)));
    });

    afterEach(() => {
        // stubGlobal(innerWidth / fetch) のテスト間汚染を防ぐ
        vi.unstubAllGlobals();
    });

    it('should mount the launcher and chat window with the configured title and placeholder', () => {
        initChatWidget({ title: 'My Bot', placeholder: 'Ask...' });
        const { launcherBtn, chatWindow, chatTitle, input } = getEls();
        expect(launcherBtn).toBeTruthy();
        expect(chatWindow).toBeTruthy();
        expect(chatTitle.textContent).toBe('My Bot');
        expect(input.placeholder).toBe('Ask...');
    });

    it('should use Japanese defaults when no config is given', () => {
        initChatWidget();
        const { chatTitle, input } = getEls();
        expect(chatTitle.textContent).toBe('AIアシスタント');
        expect(input.placeholder).toBe('質問を入力...');
    });

    it('should render the initial greeting message', () => {
        initChatWidget();
        const { timeline } = getEls();
        const greeting = timeline.querySelector('.message.makasete-server');
        expect(greeting?.innerHTML).toContain('AIアシスタント');
    });

    it('should open and close the chat window via the launcher and close button', () => {
        initChatWidget();
        const { launcherBtn, chatWindow, closeBtn } = getEls();
        expect(chatWindow.classList.contains('open')).toBe(false);
        launcherBtn.click();
        expect(chatWindow.classList.contains('open')).toBe(true);
        closeBtn.click();
        expect(chatWindow.classList.contains('open')).toBe(false);
    });

    it('should send a message on send-button click', () => {
        initChatWidget({ language: 'ja' });
        const { input, sendBtn, timeline } = getEls();
        input.value = 'hello';
        sendBtn.click();

        expect(socketHandler.sendUserInput).toHaveBeenCalledWith('hello', false, 'ja');
        expect(input.value).toBe('');
        expect(timeline.querySelector('.message.user')?.innerHTML).toBe('hello');
    });

    it('should lock body scroll on mobile when opening and restore it when closing via the launcher', () => {
        vi.stubGlobal('innerWidth', 500);
        initChatWidget();
        const { launcherBtn, chatWindow } = getEls();

        launcherBtn.click(); // open
        expect(chatWindow.classList.contains('open')).toBe(true);
        expect(document.body.style.overflow).toBe('hidden');

        launcherBtn.click(); // close via launcher
        expect(chatWindow.classList.contains('open')).toBe(false);
        expect(document.body.style.overflow).toBe('');
        expect(audioHandler.resetAudioState).toHaveBeenCalled();
    });

    it('should log an error when the health check request fails', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));

        initChatWidget();
        // fetch の rejection を処理する .catch を待つ
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(errSpy).toHaveBeenCalledWith('[MakaseteAI] Error waiting for data:', expect.any(Error));
        errSpy.mockRestore();
    });

    it('should ignore empty sends', () => {
        initChatWidget();
        const { input, sendBtn } = getEls();
        input.value = '   ';
        sendBtn.click();
        expect(socketHandler.sendUserInput).not.toHaveBeenCalled();
    });

    it('should send on Cmd/Ctrl + Enter only', () => {
        initChatWidget();
        const { input } = getEls();
        input.value = 'hi';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(socketHandler.sendUserInput).not.toHaveBeenCalled();

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
        expect(socketHandler.sendUserInput).toHaveBeenCalledWith('hi', false, 'ja');
    });

    it('should toggle send/mic buttons based on input text', () => {
        initChatWidget();
        const { input, sendBtn, micBtn } = getEls();
        input.value = 'typing';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(sendBtn.style.display).toBe('flex');
        expect(micBtn.style.display).toBe('none');

        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(sendBtn.style.display).toBe('none');
        expect(micBtn.style.display).toBe('flex');
    });

    describe('socket callbacks', () => {
        it('onTextChunk should stream-append into a new server message after the user sends', () => {
            initChatWidget();
            const { input, sendBtn, timeline } = getEls();
            input.value = 'q';
            sendBtn.click();
            captured.socketOpts!.onTextChunk('Hel');
            captured.socketOpts!.onTextChunk('lo');
            const msgs = timeline.querySelectorAll('.message.makasete-server');
            // 挨拶 + 応答1件、最後がストリーミングされた応答
            expect(msgs[msgs.length - 1].innerHTML).toBe('Hello');
        });

        it('onAudioChunk text appends text and audio forwards to the audio handler', () => {
            initChatWidget();
            const { input, sendBtn, timeline } = getEls();
            input.value = 'q';
            sendBtn.click();
            captured.socketOpts!.onAudioChunk({ type: 'text', content: 'spoken' });
            const msgs = timeline.querySelectorAll('.message.makasete-server');
            expect(msgs[msgs.length - 1].innerHTML).toBe('spoken');

            captured.socketOpts!.onAudioChunk({ type: 'audio', content: new ArrayBuffer(4) });
            expect(audioHandler.handleAudioChunk).toHaveBeenCalled();
        });

        it('onError should render an error message', () => {
            initChatWidget();
            const { timeline } = getEls();
            captured.socketOpts!.onError('boom');
            const msgs = timeline.querySelectorAll('.message.makasete-server');
            expect(msgs[msgs.length - 1].innerHTML).toContain('boom');
        });

        it('onResponseComplete and onConnect should not throw', () => {
            initChatWidget();
            expect(() => captured.socketOpts!.onResponseComplete!()).not.toThrow();
            expect(() => captured.socketOpts!.onConnect!()).not.toThrow();
        });
    });

    describe('voice', () => {
        it('onTranscript should preview text in the input without sending', () => {
            initChatWidget();
            const { input } = getEls();
            captured.audioOpts!.onTranscript('voice text');
            // 認識途中のテキストは入力欄に表示されるだけで、まだ送信されない
            expect(input.value).toBe('voice text');
            expect(socketHandler.sendUserInput).not.toHaveBeenCalled();
        });

        it('onRecordingEnd should send the finalized text once as voice', () => {
            initChatWidget();
            const { micBtn } = getEls();
            micBtn.classList.add('recording');
            captured.audioOpts!.onRecordingEnd('voice text');
            expect(micBtn.classList.contains('recording')).toBe(false);
            expect(socketHandler.sendUserInput).toHaveBeenCalledWith('voice text', true, 'ja');
            expect(audioHandler.resumeAudioContext).toHaveBeenCalled();
            expect(audioHandler.resetAudioState).toHaveBeenCalled();
        });

        it('onRecordingEnd with empty text should not send and just clear recording', () => {
            initChatWidget();
            const { micBtn } = getEls();
            micBtn.classList.add('recording');
            captured.audioOpts!.onRecordingEnd('');
            expect(micBtn.classList.contains('recording')).toBe(false);
            expect(socketHandler.sendUserInput).not.toHaveBeenCalled();
        });

        it('mic click should toggle recording when supported', () => {
            initChatWidget();
            const { micBtn } = getEls();
            micBtn.click();
            expect(audioHandler.toggleRecording).toHaveBeenCalled();
            expect(micBtn.classList.contains('recording')).toBe(true);
        });

        it('mic should be hidden and alerted when speech recognition is unsupported', () => {
            audioHandler.isSpeechRecognitionSupported.mockReturnValue(false);
            initChatWidget();
            const { micBtn, sendBtn } = getEls();
            expect(micBtn.style.display).toBe('none');
            expect(sendBtn.style.display).toBe('flex');
            micBtn.click();
            expect(window.alert).toHaveBeenCalled();
            expect(audioHandler.toggleRecording).not.toHaveBeenCalled();
        });
    });

    describe('drag', () => {
        it('should reposition the container while dragging the header', () => {
            initChatWidget();
            const { header, container } = getEls();
            // ドラッグはデスクトップ幅でのみ有効
            vi.stubGlobal('innerWidth', 1024);

            header.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 70, bubbles: true }));

            expect(container.style.left).toBe('50px');
            expect(container.style.top).toBe('60px');
            expect(container.style.right).toBe('auto');

            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        });
    });
});
