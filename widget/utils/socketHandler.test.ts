import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { ioMock, fakeSocket } = vi.hoisted(() => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const managerHandlers: Record<string, (...args: unknown[]) => void> = {};
    const onceHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    const fakeSocket = {
        handlers,
        managerHandlers,
        onceHandlers,
        connected: false,
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
            handlers[event] = cb;
        }),
        once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
            (onceHandlers[event] ??= []).push(cb);
        }),
        off: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
            onceHandlers[event] = (onceHandlers[event] ?? []).filter((h) => h !== cb);
        }),
        // 実際の socket.io と同様に、connect 時は on と once の両方を呼ぶ
        fireConnect: () => {
            fakeSocket.connected = true;
            handlers['connect']?.();
            const pending = onceHandlers['connect'] ?? [];
            onceHandlers['connect'] = [];
            for (const h of pending) h();
        },
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
        for (const key of Object.keys(fakeSocket.onceHandlers)) delete fakeSocket.onceHandlers[key];
        fakeSocket.connected = false;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function setup() {
        const cbs = {
            onTextChunk: vi.fn(),
            onAudioChunk: vi.fn(),
            onError: vi.fn(),
            onConnect: vi.fn(),
            onResponseComplete: vi.fn(),
            onRecommendation: vi.fn(),
            onConnectionLost: vi.fn(),
        };
        const handler = initSocketHandler({
            serverUrl: 'http://localhost',
            connectTimeoutMs: 1000,
            ...cbs,
        });
        return { handler, cbs };
    }

    /** 直近に送った user-input の requestId を取り出す */
    function lastRequestId(): string {
        const calls = fakeSocket.emit.mock.calls.filter((c) => c[0] === 'user-input');
        return (calls[calls.length - 1][1] as { requestId: string }).requestId;
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

    it('should emit user-input with default language ja and a requestId', () => {
        const { handler } = setup();
        fakeSocket.connected = true;
        handler.sendUserInput('hello', false);
        expect(fakeSocket.emit).toHaveBeenCalledWith('user-input', {
            text: 'hello',
            isVoiceInput: false,
            language: 'ja',
            requestId: expect.any(String),
        });
    });

    it('should emit user-input with explicit language', () => {
        const { handler } = setup();
        fakeSocket.connected = true;
        handler.sendUserInput('hi', true, 'en');
        expect(fakeSocket.emit).toHaveBeenCalledWith(
            'user-input',
            expect.objectContaining({ text: 'hi', isVoiceInput: true, language: 'en' }),
        );
    });

    it('should use a new requestId for every send', () => {
        const { handler } = setup();
        fakeSocket.connected = true;
        handler.sendUserInput('a', false);
        const first = lastRequestId();
        handler.sendUserInput('b', false);
        expect(lastRequestId()).not.toBe(first);
    });

    describe('stale response filtering', () => {
        it('should drop events that belong to an earlier request', () => {
            // 応答 A のストリーミング中に B を送ると、A の残りのチャンクが遅れて
            // 届くことがある。これを B の応答として表示してはいけない。
            const { handler, cbs } = setup();
            fakeSocket.connected = true;
            handler.sendUserInput('A', false);
            const idA = lastRequestId();
            handler.sendUserInput('B', false);
            const idB = lastRequestId();

            fakeSocket.handlers['text-chunk']({ content: 'Aの残り', requestId: idA });
            fakeSocket.handlers['audio-chunk']({ type: 'audio', content: 'x', requestId: idA });
            fakeSocket.handlers['recommendation']({ products: [], requestId: idA });
            fakeSocket.handlers['response-complete']({ requestId: idA });
            fakeSocket.handlers['error']({ message: 'old', requestId: idA });
            expect(cbs.onTextChunk).not.toHaveBeenCalled();
            expect(cbs.onAudioChunk).not.toHaveBeenCalled();
            expect(cbs.onRecommendation).not.toHaveBeenCalled();
            expect(cbs.onResponseComplete).not.toHaveBeenCalled();
            expect(cbs.onError).not.toHaveBeenCalled();

            fakeSocket.handlers['text-chunk']({ content: 'Bの応答', requestId: idB });
            expect(cbs.onTextChunk).toHaveBeenCalledWith('Bの応答');
        });

        it('should accept events without a requestId (older servers)', () => {
            const { handler, cbs } = setup();
            fakeSocket.connected = true;
            handler.sendUserInput('A', false);

            fakeSocket.handlers['text-chunk']({ content: 'hi' });
            fakeSocket.handlers['response-complete']();
            expect(cbs.onTextChunk).toHaveBeenCalledWith('hi');
            expect(cbs.onResponseComplete).toHaveBeenCalled();
        });
    });

    describe('connection handling', () => {
        it('should hold the send until connected instead of letting socket.io buffer it', () => {
            const { handler } = setup();
            handler.sendUserInput('hello', false);
            expect(fakeSocket.emit).not.toHaveBeenCalled();

            fakeSocket.fireConnect();
            expect(fakeSocket.emit).toHaveBeenCalledWith(
                'user-input',
                expect.objectContaining({ text: 'hello' }),
            );
        });

        it('should report a connect timeout and never send the stale input later', () => {
            vi.useFakeTimers();
            const { handler, cbs } = setup();
            handler.sendUserInput('hello', false);

            vi.advanceTimersByTime(1000);
            expect(cbs.onConnectionLost).toHaveBeenCalledWith('connect-timeout');

            // 後から接続できても、諦めた入力が突然送られてはいけない
            fakeSocket.fireConnect();
            expect(fakeSocket.emit).not.toHaveBeenCalled();
        });

        it('should fail fast when reconnection gives up while waiting to send', () => {
            vi.spyOn(console, 'warn').mockImplementation(() => {});
            const { handler, cbs } = setup();
            handler.sendUserInput('hello', false);

            fakeSocket.managerHandlers['reconnect_failed']();
            expect(cbs.onConnectionLost).toHaveBeenCalledWith('connect-timeout');
        });

        it('should only send the latest input when several are queued while offline', () => {
            const { handler } = setup();
            handler.sendUserInput('first', false);
            handler.sendUserInput('second', false);

            fakeSocket.fireConnect();
            const sent = fakeSocket.emit.mock.calls.filter((c) => c[0] === 'user-input');
            expect(sent).toHaveLength(1);
            expect(sent[0][1]).toEqual(expect.objectContaining({ text: 'second' }));
        });

        it('should report a lost connection while a response is pending', () => {
            const { handler, cbs } = setup();
            fakeSocket.connected = true;
            handler.sendUserInput('hello', false);

            fakeSocket.handlers['disconnect']('transport close');
            expect(cbs.onConnectionLost).toHaveBeenCalledWith('disconnected');
        });

        it('should stay silent on disconnect when no response is pending', () => {
            const { handler, cbs } = setup();
            fakeSocket.connected = true;
            handler.sendUserInput('hello', false);
            fakeSocket.handlers['response-complete']({ requestId: lastRequestId() });

            fakeSocket.handlers['disconnect']('transport close');
            expect(cbs.onConnectionLost).not.toHaveBeenCalled();
        });

        it('should not report a disconnect that the client initiated', () => {
            const { handler, cbs } = setup();
            fakeSocket.connected = true;
            handler.sendUserInput('hello', false);

            fakeSocket.handlers['disconnect']('io client disconnect');
            expect(cbs.onConnectionLost).not.toHaveBeenCalled();
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
