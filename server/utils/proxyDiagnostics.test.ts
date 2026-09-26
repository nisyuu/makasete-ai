import { describe, it, expect, vi } from 'vitest';
import { createProxyHeaderLogger, describeForwardedFor } from './proxyDiagnostics';

describe('describeForwardedFor', () => {
    it('should report no hops when the header is absent', () => {
        expect(describeForwardedFor(undefined, '10.0.0.1')).toEqual({
            hopCount: 0,
            hops: [],
            resolved: '10.0.0.1',
        });
    });

    it('should split the chain and keep the order', () => {
        expect(describeForwardedFor('1.2.3.4, 203.0.113.5', '203.0.113.5')).toEqual({
            hopCount: 2,
            hops: ['1.2.3.4', '203.0.113.5'],
            resolved: '203.0.113.5',
        });
    });

    it('should join array headers', () => {
        expect(describeForwardedFor(['1.2.3.4', '5.6.7.8'], '5.6.7.8').hopCount).toBe(2);
    });
});

describe('createProxyHeaderLogger', () => {
    function makeLogger() {
        return { info: vi.fn(), warn: vi.fn() };
    }

    it('should log at info level when the hop count matches', () => {
        const logger = makeLogger();
        const log = createProxyHeaderLogger({ expectedHopCount: 1, logger });

        log('http', '203.0.113.5', '203.0.113.5');

        expect(logger.info).toHaveBeenCalledTimes(1);
        expect(logger.warn).not.toHaveBeenCalled();
        expect(logger.info.mock.calls[0][0]).toContain('hops=1');
    });

    it('should warn and name the setting when the hop count differs', () => {
        // ホップ数が想定より多い = 前段に別のプロキシがいる。
        // このまま運用すると全利用者が同じキーにまとめられる。
        const logger = makeLogger();
        const log = createProxyHeaderLogger({ expectedHopCount: 1, logger });

        log('socket', '1.2.3.4, 203.0.113.5', '203.0.113.5');

        expect(logger.warn).toHaveBeenCalledTimes(1);
        const message = logger.warn.mock.calls[0][0];
        expect(message).toContain('hops=2');
        expect(message).toContain('TRUSTED_PROXY_COUNT');
    });

    it('should stop logging after the limit', () => {
        const logger = makeLogger();
        const log = createProxyHeaderLogger({ expectedHopCount: 1, limit: 2, logger });

        log('http', '203.0.113.5', '203.0.113.5');
        log('http', '203.0.113.5', '203.0.113.5');
        log('http', '203.0.113.5', '203.0.113.5');

        expect(logger.info).toHaveBeenCalledTimes(2);
    });
});
