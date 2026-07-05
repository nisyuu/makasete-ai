import { describe, it, expect, vi, beforeEach } from 'vitest';

const { ioMock, fakeSocket } = vi.hoisted(() => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const managerHandlers: Record<string, (...args: unknown[]) => void> = {};
    const fakeSocket = {
        handlers,
        managerHandlers,
        connected: false,
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
            handlers[event] = cb;
        }),
        io: {
            on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
                managerHandlers[event] = cb;
            }),
        },
        emit: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
    };
    return { ioMock: vi.fn(() => fakeSocket), fakeSocket };
});

vi.mock('socket.io-client', () => ({ io: ioMock }));

import { initSocketHandler } from './socketHandler';

describe('initSocketHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        for (const key of Object.keys(fakeSocket.handlers)) delete fakeSocket.handlers[key];
        for (const key of Object.keys(fakeSocket.managerHandlers)) delete fakeSocket.managerHandlers[key];
        fakeSocket.connected = false;
    });

    function setup() {
        const cbs = {
            onTextChunk: vi.fn(),
            onAudioChunk: vi.fn(),
            onError: vi.fn(),
            onConnect: vi.fn(),
            onResponseComplete: vi.fn(),
        };
        const handler = initSocketHandler({ serverUrl: 'http://localhost', ...cbs });
        return { handler, cbs };
    }

    it('should connect to the provided server url without a trailing slash', () => {
        setup();
        // addTrailingSlash: false を明示し、末尾スラッシュを除去するプロキシ
        // (Firebase App Hosting 等) の背後でも 404 にならないようにする。
        // 再接続は上限付きバックオフとし、404 への無限リトライを防ぐ。
        expect(ioMock).toHaveBeenCalledWith('http://localhost', {
            addTrailingSlash: false,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 30000,
        });
    });

    it('should warn (not spam the chat) when reconnection gives up', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { cbs } = setup();

        expect(fakeSocket.managerHandlers['reconnect_failed']).toBeDefined();
        fakeSocket.managerHandlers['reconnect_failed']();

        expect(warnSpy).toHaveBeenCalled();
        expect(cbs.onError).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('should route socket events to the corresponding callbacks', () => {
        const { cbs } = setup();

        fakeSocket.handlers['connect']();
        expect(cbs.onConnect).toHaveBeenCalled();

        fakeSocket.handlers['text-chunk']({ content: 'hi' });
        expect(cbs.onTextChunk).toHaveBeenCalledWith('hi');

        const audioData = { type: 'audio', content: 'x' };
        fakeSocket.handlers['audio-chunk'](audioData);
        expect(cbs.onAudioChunk).toHaveBeenCalledWith(audioData);

        fakeSocket.handlers['error']({ message: 'oops' });
        expect(cbs.onError).toHaveBeenCalledWith('oops');

        fakeSocket.handlers['response-complete']();
        expect(cbs.onResponseComplete).toHaveBeenCalled();
    });

    it('should not throw when optional callbacks are omitted', () => {
        const handler = initSocketHandler({
            serverUrl: 'http://localhost',
            onTextChunk: vi.fn(),
            onAudioChunk: vi.fn(),
            onError: vi.fn(),
        });
        expect(() => fakeSocket.handlers['connect']()).not.toThrow();
        expect(() => fakeSocket.handlers['response-complete']()).not.toThrow();
        expect(handler).toBeTruthy();
    });

    it('should reconnect on user input after retries were exhausted', () => {
        const { handler } = setup();

        fakeSocket.connected = false;
        handler.sendUserInput('hello', false);
        expect(fakeSocket.connect).toHaveBeenCalledTimes(1);

        fakeSocket.connected = true;
        handler.sendUserInput('hello again', false);
        expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
    });

    it('should emit user-input with default language ja', () => {
        const { handler } = setup();
        handler.sendUserInput('hello', false);
        expect(fakeSocket.emit).toHaveBeenCalledWith('user-input', {
            text: 'hello',
            isVoiceInput: false,
            language: 'ja',
        });
    });

    it('should emit user-input with explicit language', () => {
        const { handler } = setup();
        handler.sendUserInput('hi', true, 'en');
        expect(fakeSocket.emit).toHaveBeenCalledWith('user-input', {
            text: 'hi',
            isVoiceInput: true,
            language: 'en',
        });
    });

    it('should expose disconnect and connection status', () => {
        const { handler } = setup();
        expect(handler.isConnected()).toBe(false);
        fakeSocket.connected = true;
        expect(handler.isConnected()).toBe(true);

        handler.disconnect();
        expect(fakeSocket.disconnect).toHaveBeenCalled();
    });
});
