// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { initDragHandler } from './dragHandler';

function setWindowWidth(width: number) {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
}

describe('initDragHandler', () => {
    let container: HTMLElement;
    let header: HTMLElement;
    let launcherBtn: HTMLButtonElement;
    let onDragStateChange: Mock<(isDragging: boolean) => void>;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = document.createElement('div');
        header = document.createElement('div');
        launcherBtn = document.createElement('button');
        header.appendChild(launcherBtn);
        container.appendChild(header);
        document.body.appendChild(container);
        onDragStateChange = vi.fn();
        setWindowWidth(1024);
    });

    it('should start dragging once the pointer moves beyond the threshold', () => {
        const cleanup = initDragHandler(container, [header], launcherBtn, onDragStateChange);

        header.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 110, clientY: 110, bubbles: true }));

        expect(onDragStateChange).toHaveBeenCalledWith(true);
        expect(container.style.left).toBe('10px');
        expect(container.style.top).toBe('10px');
        expect(container.style.bottom).toBe('auto');

        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        cleanup();
    });

    it('should not start dragging for sub-threshold movement', () => {
        initDragHandler(container, [header], launcherBtn, onDragStateChange);
        header.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 102, clientY: 102, bubbles: true }));

        // reset(false) は呼ばれるが、true は呼ばれない
        expect(onDragStateChange).not.toHaveBeenCalledWith(true);
    });

    it('should be disabled on small (mobile) screens', () => {
        setWindowWidth(500);
        initDragHandler(container, [header], launcherBtn, onDragStateChange);
        header.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));
        expect(onDragStateChange).not.toHaveBeenCalled();
    });

    it('should ignore drags initiated on non-launcher buttons', () => {
        const otherBtn = document.createElement('button');
        header.appendChild(otherBtn);
        initDragHandler(container, [header], launcherBtn, onDragStateChange);

        otherBtn.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
        expect(onDragStateChange).not.toHaveBeenCalled();
    });

    it('should still allow dragging from the launcher button itself', () => {
        initDragHandler(container, [header], launcherBtn, onDragStateChange);
        launcherBtn.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
        expect(onDragStateChange).toHaveBeenCalledWith(false);
    });

    it('should support touch events', () => {
        initDragHandler(container, [header], launcherBtn, onDragStateChange);

        header.dispatchEvent(
            new TouchEvent('touchstart', {
                bubbles: true,
                touches: [{ clientX: 50, clientY: 50 } as Touch],
            }),
        );
        document.dispatchEvent(
            new TouchEvent('touchmove', {
                bubbles: true,
                touches: [{ clientX: 80, clientY: 80 } as Touch],
            }),
        );
        expect(onDragStateChange).toHaveBeenCalledWith(true);
        document.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
    });

    it('should remove listeners on cleanup', () => {
        const cleanup = initDragHandler(container, [header], launcherBtn, onDragStateChange);
        cleanup();
        header.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));
        expect(onDragStateChange).not.toHaveBeenCalled();
    });

    const tick = () => new Promise((r) => setTimeout(r, 0));

    it('should clear the dragging state after the click that follows mouseup', async () => {
        // ランチャーの click は isDragging を見て開閉を抑止する。mouseup で即座に
        // false へ戻すとドラッグのたびにチャットが開く。click 判定の後に戻す。
        initDragHandler(container, [header], launcherBtn, onDragStateChange);

        header.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 200, bubbles: true }));
        onDragStateChange.mockClear();

        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        expect(onDragStateChange).not.toHaveBeenCalled();

        await tick();
        expect(onDragStateChange).toHaveBeenCalledWith(false);
    });

    it('should not fire a state change on mouseup when no drag happened', async () => {
        initDragHandler(container, [header], launcherBtn, onDragStateChange);
        header.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
        onDragStateChange.mockClear();

        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        await tick();
        expect(onDragStateChange).not.toHaveBeenCalled();
    });

    it('should keep the widget inside the viewport', () => {
        // クランプしないと画面外まで運べてしまい、リロードするまで操作不能になる
        initDragHandler(container, [header], launcherBtn, onDragStateChange);

        header.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 9000, clientY: 9000, bubbles: true }));

        expect(parseFloat(container.style.left)).toBeLessThanOrEqual(window.innerWidth);
        expect(parseFloat(container.style.top)).toBeLessThanOrEqual(window.innerHeight);
    });

    it('should not allow negative positions', () => {
        initDragHandler(container, [header], launcherBtn, onDragStateChange);

        header.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: -500, clientY: -500, bubbles: true }));

        expect(container.style.left).toBe('0px');
        expect(container.style.top).toBe('0px');
    });

    it('should stop dragging on touchcancel', () => {
        // OS にタッチを奪われたときにリスナーが残り続けるのを防ぐ
        initDragHandler(container, [header], launcherBtn, onDragStateChange);

        header.dispatchEvent(
            new TouchEvent('touchstart', {
                bubbles: true,
                touches: [{ clientX: 50, clientY: 50 } as Touch],
            }),
        );
        document.dispatchEvent(
            new TouchEvent('touchmove', {
                bubbles: true,
                touches: [{ clientX: 100, clientY: 100 } as Touch],
            }),
        );
        const movedLeft = container.style.left;

        document.dispatchEvent(new TouchEvent('touchcancel', { bubbles: true }));
        document.dispatchEvent(
            new TouchEvent('touchmove', {
                bubbles: true,
                touches: [{ clientX: 300, clientY: 300 } as Touch],
            }),
        );

        expect(container.style.left).toBe(movedLeft);
    });

    it('should re-clamp the position when the viewport shrinks', () => {
        initDragHandler(container, [header], launcherBtn, onDragStateChange);

        header.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900, clientY: 300, bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

        setWindowWidth(400);
        window.dispatchEvent(new Event('resize'));

        expect(parseFloat(container.style.left)).toBeLessThanOrEqual(400);
    });
});
