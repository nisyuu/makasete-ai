// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
    getUIElements,
    updateInputActions,
    showTypingIndicator,
    hideTypingIndicator,
    scrollToBottom,
    appendMessage,
    appendRecommendations,
    applyPrimaryColor,
    hideLoadingOverlay,
    MessageState,
} from './uiRenderer';
import type { Product } from '../types';

function buildProduct(overrides: Partial<Product> = {}): Product {
    return {
        name: 'Coffee',
        description: 'A nice cup',
        price: '¥500',
        image_url: 'https://example.com/img.png',
        url: 'https://example.com/buy',
        tags: '',
        ...overrides,
    };
}

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

    describe('appendRecommendations', () => {
        let timeline: HTMLElement;

        beforeEach(() => {
            timeline = document.createElement('div');
        });

        it('should render a product card with all fields', () => {
            appendRecommendations(timeline, [buildProduct()]);
            const container = timeline.querySelector('.recommendations');
            expect(container).toBeTruthy();
            const card = container?.querySelector('.product-card');
            expect(card?.tagName).toBe('A');
            expect((card as HTMLAnchorElement).href).toBe('https://example.com/buy');
            expect((card as HTMLAnchorElement).target).toBe('_blank');
            expect((card as HTMLAnchorElement).rel).toBe('noopener noreferrer');
            expect(card?.querySelector('.product-image')).toBeTruthy();
            expect(card?.querySelector('.product-name')?.textContent).toBe('Coffee');
            expect(card?.querySelector('.product-desc')?.textContent).toBe('A nice cup');
            expect(card?.querySelector('.product-price')?.textContent).toBe('¥500');
        });

        it('should render a div (not anchor) when the url is invalid', () => {
            appendRecommendations(timeline, [buildProduct({ url: 'javascript:alert(1)' })]);
            const card = timeline.querySelector('.product-card');
            expect(card?.tagName).toBe('DIV');
        });

        it('should omit the image when the image url is invalid', () => {
            appendRecommendations(timeline, [buildProduct({ image_url: 'not-a-url' })]);
            expect(timeline.querySelector('.product-image')).toBeNull();
        });

        it('should omit description and price when they are empty', () => {
            appendRecommendations(timeline, [buildProduct({ description: '', price: '' })]);
            expect(timeline.querySelector('.product-desc')).toBeNull();
            expect(timeline.querySelector('.product-price')).toBeNull();
        });

        it('should escape HTML in product fields', () => {
            appendRecommendations(timeline, [
                buildProduct({ name: '<img src=x onerror=alert(1)>', description: 'a & b "c"' }),
            ]);
            const name = timeline.querySelector('.product-name');
            expect(name?.textContent).toBe('<img src=x onerror=alert(1)>');
            expect(name?.querySelector('img')).toBeNull();
            expect(timeline.querySelector('.product-desc')?.textContent).toBe('a & b "c"');
        });

        it('should replace existing recommendations rather than stacking them', () => {
            appendRecommendations(timeline, [buildProduct({ name: 'First' })]);
            appendRecommendations(timeline, [buildProduct({ name: 'Second' })]);
            expect(timeline.querySelectorAll('.recommendations')).toHaveLength(1);
            expect(timeline.querySelector('.product-name')?.textContent).toBe('Second');
        });

        it('should clear recommendations and render nothing when given an empty list', () => {
            appendRecommendations(timeline, [buildProduct()]);
            appendRecommendations(timeline, []);
            expect(timeline.querySelector('.recommendations')).toBeNull();
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
