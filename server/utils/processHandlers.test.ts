import { describe, it, expect, vi } from 'vitest';
import { installProcessHandlers, ProcessLike } from './processHandlers';

type Listener = (arg: unknown) => void;

function makeProcess() {
    const listeners = new Map<string, Listener>();
    const exit = vi.fn();
    const proc = {
        on: (event: string, listener: Listener) => {
            listeners.set(event, listener);
        },
        exit,
    } as unknown as ProcessLike;
    const emit = (event: string, arg: unknown) => listeners.get(event)?.(arg);
    return { proc, exit, emit };
}

function makeTimer() {
    const pending: Array<{ fn: () => void; ms: number }> = [];
    const setTimer = vi.fn((fn: () => void, ms: number) => {
        pending.push({ fn, ms });
        return { unref: vi.fn() };
    });
    return { setTimer, pending };
}

describe('installProcessHandlers', () => {
    const logger = { error: vi.fn() };

    it('should log an unhandled rejection and keep the process alive', () => {
        const { proc, exit, emit } = makeProcess();
        installProcessHandlers(proc, { logger });

        emit('unhandledRejection', new Error('boom'));

        expect(logger.error).toHaveBeenCalledWith(
            '[Process] Unhandled rejection:',
            expect.stringContaining('boom'),
        );
        expect(exit).not.toHaveBeenCalled();
    });

    it('should exit immediately on an uncaught exception when no server is given', () => {
        const { proc, exit, emit } = makeProcess();
        const { setTimer } = makeTimer();
        installProcessHandlers(proc, { logger, setTimer });

        emit('uncaughtException', new Error('fatal'));

        expect(exit).toHaveBeenCalledWith(1);
    });

    it('should close the server before exiting on an uncaught exception', () => {
        const { proc, exit, emit } = makeProcess();
        const { setTimer } = makeTimer();
        let onClosed: (() => void) | undefined;
        const server = { close: vi.fn((cb?: () => void) => { onClosed = cb; }) };
        installProcessHandlers(proc, { logger, server, setTimer });

        emit('uncaughtException', new Error('fatal'));

        expect(server.close).toHaveBeenCalledTimes(1);
        expect(exit).not.toHaveBeenCalled();

        onClosed?.();
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('should force exit after the timeout when close never completes', () => {
        const { proc, exit, emit } = makeProcess();
        const { setTimer, pending } = makeTimer();
        const server = { close: vi.fn() };
        installProcessHandlers(proc, { logger, server, setTimer, shutdownTimeoutMs: 3000 });

        emit('uncaughtException', new Error('fatal'));
        expect(exit).not.toHaveBeenCalled();
        expect(pending[0].ms).toBe(3000);

        pending[0].fn();
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('should not start a second shutdown when another exception arrives', () => {
        const { proc, emit } = makeProcess();
        const { setTimer } = makeTimer();
        const server = { close: vi.fn() };
        installProcessHandlers(proc, { logger, server, setTimer });

        emit('uncaughtException', new Error('first'));
        emit('uncaughtException', new Error('second'));

        expect(server.close).toHaveBeenCalledTimes(1);
        expect(setTimer).toHaveBeenCalledTimes(1);
    });
});
