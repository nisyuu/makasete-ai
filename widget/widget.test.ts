// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

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
    onRecordingEnd: () => void;
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
    resumeAudioContext: vi.fn(),
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
        container: shadow.querySelector('.container') as HTMLElement,
        header: shadow.querySelector('.header') as HTMLElement,
        messages: shadow.querySelector('.messages') as HTMLElement,
        input: shadow.querySelector('input[type="text"]') as HTMLInputElement,
        sendBtn: Array.from(shadow.querySelectorAll('button')).find((b) => b.textContent === 'Send') as HTMLButtonElement,
        micBtn: shadow.querySelector('button.mic') as HTMLButtonElement,
    };
}

describe('initChatWidget', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
        audioHandler.isSpeechRecognitionSupported.mockReturnValue(true);
        window.alert = vi.fn();
    });

    it('should mount a shadow-dom widget with the configured title and placeholder', () => {
        initChatWidget({ title: 'My Bot', placeholder: 'Ask...' });
        const { header, input } = getEls();
        expect(header.textContent).toBe('My Bot');
        expect(input.placeholder).toBe('Ask...');
    });

    it('should use sensible defaults when no config is given', () => {
        initChatWidget();
        const { header } = getEls();
        expect(header.textContent).toBe('Chat Assistant');
    });

    it('should send a message on send-button click and lock the input', () => {
        initChatWidget({ language: 'ja' });
        const { input, sendBtn, messages } = getEls();
        input.value = 'hello';
        sendBtn.click();

        expect(socketHandler.sendUserInput).toHaveBeenCalledWith('hello', false, 'ja');
        expect(input.value).toBe('');
        expect(input.disabled).toBe(true);
        expect(messages.querySelector('.msg.user')?.textContent).toBe('hello');
    });

    it('should ignore empty sends', () => {
        initChatWidget();
        const { input, sendBtn } = getEls();
        input.value = '   ';
        sendBtn.click();
        expect(socketHandler.sendUserInput).not.toHaveBeenCalled();
    });

    it('should send on Enter key', () => {
        initChatWidget();
        const { input } = getEls();
        input.value = 'hi';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(socketHandler.sendUserInput).toHaveBeenCalledWith('hi', false, 'ja');
    });

    it('should not send on other keys', () => {
        initChatWidget();
        const { input } = getEls();
        input.value = 'hi';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        expect(socketHandler.sendUserInput).not.toHaveBeenCalled();
    });

    describe('socket callbacks', () => {
        it('onTextChunk should append streaming text to an assistant message', () => {
            initChatWidget();
            const { messages } = getEls();
            captured.socketOpts!.onTextChunk('Hel');
            captured.socketOpts!.onTextChunk('lo');
            const assistant = messages.querySelector('.msg.assistant');
            expect(assistant?.textContent).toBe('Hello');
        });

        it('onAudioChunk text should append text, audio should forward to the audio handler', () => {
            initChatWidget();
            captured.socketOpts!.onAudioChunk({ type: 'text', content: 'spoken' });
            const { messages } = getEls();
            expect(messages.querySelector('.msg.assistant')?.textContent).toBe('spoken');

            captured.socketOpts!.onAudioChunk({ type: 'audio', content: new ArrayBuffer(4) });
            expect(audioHandler.handleAudioChunk).toHaveBeenCalled();
        });

        it('onError should render an error message and unlock the input', () => {
            initChatWidget();
            const { input, messages } = getEls();
            input.disabled = true;
            captured.socketOpts!.onError('boom');
            expect(messages.querySelector('.msg.assistant')?.textContent).toBe('Error: boom');
            expect(input.disabled).toBe(false);
        });

        it('onResponseComplete should unlock the input', () => {
            initChatWidget();
            const { input } = getEls();
            input.disabled = true;
            captured.socketOpts!.onResponseComplete!();
            expect(input.disabled).toBe(false);
        });

        it('onConnect should not throw', () => {
            initChatWidget();
            expect(() => captured.socketOpts!.onConnect!()).not.toThrow();
        });
    });

    describe('voice', () => {
        it('onTranscript should populate the input and send as voice', () => {
            initChatWidget();
            captured.audioOpts!.onTranscript('voice text');
            expect(socketHandler.sendUserInput).toHaveBeenCalledWith('voice text', true, 'ja');
            expect(audioHandler.resumeAudioContext).toHaveBeenCalled();
            expect(audioHandler.resetAudioState).toHaveBeenCalled();
        });

        it('onRecordingEnd should remove the recording class', () => {
            initChatWidget();
            const { micBtn } = getEls();
            micBtn.classList.add('recording');
            captured.audioOpts!.onRecordingEnd();
            expect(micBtn.classList.contains('recording')).toBe(false);
        });

        it('mic click should toggle recording when supported', () => {
            initChatWidget();
            const { micBtn } = getEls();
            micBtn.click();
            expect(audioHandler.initAudioContext).toHaveBeenCalled();
            expect(audioHandler.toggleRecording).toHaveBeenCalled();
            expect(micBtn.classList.contains('recording')).toBe(true);
        });

        it('mic click should alert when speech recognition is unsupported', () => {
            audioHandler.isSpeechRecognitionSupported.mockReturnValue(false);
            initChatWidget();
            const { micBtn } = getEls();
            micBtn.click();
            expect(window.alert).toHaveBeenCalled();
            expect(audioHandler.toggleRecording).not.toHaveBeenCalled();
        });
    });

    describe('drag', () => {
        it('should reposition the container while dragging', () => {
            initChatWidget();
            const { header, container } = getEls();

            header.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 60, clientY: 70, bubbles: true }));

            // offset = mousedown座標 - rect.left(=0)。left = clientX - offset = 60 - 10 = 50
            expect(container.style.left).toBe('50px');
            expect(container.style.top).toBe('60px');
            expect(container.style.right).toBe('auto');

            document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            // mouseup 後は移動しない
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));
            expect(container.style.left).toBe('50px');
        });
    });
});
