import { describe, it, expect } from 'vitest';
import { ConnectionCounter } from './connectionCounter';

describe('ConnectionCounter', () => {
    it('should allow up to the limit and then refuse', () => {
        const counter = new ConnectionCounter(2);
        expect(counter.acquire('a')).toBeTypeOf('function');
        expect(counter.acquire('a')).toBeTypeOf('function');
        expect(counter.acquire('a')).toBeNull();
    });

    it('should free a slot when released', () => {
        const counter = new ConnectionCounter(1);
        const release = counter.acquire('a')!;
        expect(counter.acquire('a')).toBeNull();

        release();
        expect(counter.count('a')).toBe(0);
        expect(counter.acquire('a')).toBeTypeOf('function');
    });

    it('should not double-decrement when released twice', () => {
        // 接続が閉じたイベントと切断イベントの両方から解放されても、
        // 他の接続の枠を誤って空けてはいけない。
        const counter = new ConnectionCounter(2);
        const first = counter.acquire('a')!;
        counter.acquire('a');
        expect(counter.count('a')).toBe(2);

        first();
        first();
        first();
        expect(counter.count('a')).toBe(1);
    });

    it('should count keys independently', () => {
        const counter = new ConnectionCounter(1);
        expect(counter.acquire('a')).toBeTypeOf('function');
        expect(counter.acquire('b')).toBeTypeOf('function');
        expect(counter.acquire('a')).toBeNull();
    });

    it('should drop the key entirely once every connection is released', () => {
        // キーを残したままにすると、IP ごとのエントリが無制限に増える
        const counter = new ConnectionCounter(2);
        const first = counter.acquire('a')!;
        const second = counter.acquire('a')!;
        first();
        second();
        expect(counter.size()).toBe(0);
    });

    it('should never lock a key out permanently when connections are released', () => {
        // ハンドシェイク直後に切れる接続を繰り返しても、枠は残り続けない
        const counter = new ConnectionCounter(5);
        for (let i = 0; i < 100; i++) {
            const release = counter.acquire('a');
            expect(release).toBeTypeOf('function');
            release!();
        }
        expect(counter.acquire('a')).toBeTypeOf('function');
    });
});
