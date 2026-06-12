// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
    getUIElements,
    updateInputActions,
    showTypingIndicator,
    hideTypingIndicator,
    scrollToBottom,
    appendMessage,
    applyPrimaryColor,
    hideLoadingOverlay,
    MessageState,
} from './uiRenderer';

function buildShadow(): ShadowRoot {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
        <div class="widget-container">
            <div class="chat-window">
                <div class="chat-title"></div>
                <div class="chat-timeline"></div>
                <textarea class="text-input"></textarea>
                <button class="send-btn"></button>
                <button class="mic-btn"></button>
                <button class="launcher-button"></button>
                <div class="loading-overlay"></div>
                <button class="close-btn"></button>
            </div>
        </div>
    `;
    return shadow;
}

describe('uiRenderer', () => {
    describe('getUIElements', () => {
        it('should resolve all the expected elements', () => {
            const shadow = buildShadow();
            const els = getUIElements(shadow);
            expect(els.container).toBeTruthy();
            expect(els.timeline).toBeTruthy();
            expect(els.input).toBeInstanceOf(HTMLTextAreaElement);
            expect(els.sendBtn).toBeInstanceOf(HTMLButtonElement);
            expect(els.closeBtn).toBeTruthy();
        });
    });

    describe('updateInputActions', () => {
        let input: HTMLTextAreaElement;
        let sendBtn: HTMLButtonElement;
        let micBtn: HTMLButtonElement;

        beforeEach(() => {
            input = document.createElement('textarea');
            sendBtn = document.createElement('button');
            micBtn = document.createElement('button');
        });

        it('should show the send button when there is text', () => {
            input.value = 'hello';
            updateInputActions(input, sendBtn, micBtn);
            expect(sendBtn.style.display).toBe('flex');
            expect(micBtn.style.display).toBe('none');
        });

        it('should show the mic button when the input is empty', () => {
            input.value = '   ';
            updateInputActions(input, sendBtn, micBtn);
            expect(sendBtn.style.display).toBe('none');
            expect(micBtn.style.display).toBe('flex');
        });
    });

    describe('typing indicator', () => {
        it('should add and remove a single typing indicator', () => {
            const timeline = document.createElement('div');
            showTypingIndicator(timeline);
            showTypingIndicator(timeline); // 二重に追加されないこと
            expect(timeline.querySelectorAll('.typing-indicator')).toHaveLength(1);

            hideTypingIndicator(timeline);
            expect(timeline.querySelector('.typing-indicator')).toBeNull();
        });

        it('should be a no-op to hide when nothing is present', () => {
            const timeline = document.createElement('div');
            expect(() => hideTypingIndicator(timeline)).not.toThrow();
        });
    });

    describe('appendMessage', () => {
        let timeline: HTMLElement;
        let state: MessageState;

        beforeEach(() => {
            timeline = document.createElement('div');
            state = { currentMakaseteServerMessageRaw: '' };
        });

        it('should append a user message', () => {
            appendMessage(timeline, state, 'user', 'Hello');
            const msg = timeline.querySelector('.message.user');
            expect(msg?.innerHTML).toBe('Hello');
        });

        it('should append a server message and remove the typing indicator', () => {
            showTypingIndicator(timeline);
            appendMessage(timeline, state, 'makasete-server', 'Hi there');
            expect(timeline.querySelector('.typing-indicator')).toBeNull();
            expect(timeline.querySelector('.message.makasete-server')?.innerHTML).toBe('Hi there');
            expect(state.currentMakaseteServerMessageRaw).toBe('Hi there');
        });

        it('should stream-append to the last server message', () => {
            appendMessage(timeline, state, 'makasete-server', 'Hello');
            appendMessage(timeline, state, 'makasete-server', ' World', true);
            const msgs = timeline.querySelectorAll('.message.makasete-server');
            expect(msgs).toHaveLength(1);
            expect(msgs[0].innerHTML).toBe('Hello World');
            expect(state.currentMakaseteServerMessageRaw).toBe('Hello World');
        });

        it('should create a new message when appendToLast has no prior server message', () => {
            appendMessage(timeline, state, 'user', 'Q');
            appendMessage(timeline, state, 'makasete-server', 'A', true);
            expect(timeline.querySelectorAll('.message.makasete-server')).toHaveLength(1);
        });
    });

    describe('misc helpers', () => {
        it('applyPrimaryColor should set the css variable on the host', () => {
            const shadow = buildShadow();
            applyPrimaryColor(shadow, 'rgb(255, 0, 0)');
            expect((shadow.host as HTMLElement).style.getPropertyValue('--primary-color')).toBe('rgb(255, 0, 0)');
        });

        it('hideLoadingOverlay should add the hidden class', () => {
            const overlay = document.createElement('div');
            hideLoadingOverlay(overlay);
            expect(overlay.classList.contains('hidden')).toBe(true);
        });

        it('scrollToBottom should not throw', () => {
            const timeline = document.createElement('div');
            expect(() => scrollToBottom(timeline)).not.toThrow();
        });
    });
});
