/** ドラッグ開始と判定するまでの移動量（px）。誤操作でのドラッグ開始を防ぐ */
const DRAG_THRESHOLD_PX = 5;

/** ドラッグを有効にする最小の画面幅（これ以下では無効） */
const DRAG_MIN_VIEWPORT_WIDTH = 600;

/**
 * ウィジェットのドラッグ移動機能を初期化する
 *
 * @param container - ドラッグ対象のウィジェットコンテナ
 * @param handles - ドラッグ操作を開始できるハンドル要素の配列（ランチャーボタン・ヘッダーなど）
 * @param launcherBtn - ランチャーボタン（ヘッダー内の他ボタンと区別するため）
 * @param onDragStateChange - ドラッグ状態が変化したときのコールバック
 * @returns クリーンアップ関数
 */
export function initDragHandler(
  container: HTMLElement,
  handles: HTMLElement[],
  launcherBtn: HTMLButtonElement,
  onDragStateChange: (isDragging: boolean) => void,
): () => void {
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let containerPosX = 0;
  let containerPosY = 0;
  // 一度でも移動したか。画面サイズが変わったときに再クランプするかの判断に使う
  let hasMoved = false;

  /**
   * ウィジェットが画面内に収まる位置へ丸める。
   * クランプしないと画面外まで運べてしまい、リロードするまで操作不能になる。
   */
  function clampToViewport(left: number, top: number): { left: number; top: number } {
    const rect = container.getBoundingClientRect();
    const maxLeft = Math.max(window.innerWidth - rect.width, 0);
    const maxTop = Math.max(window.innerHeight - rect.height, 0);
    return {
      left: Math.min(Math.max(left, 0), maxLeft),
      top: Math.min(Math.max(top, 0), maxTop),
    };
  }

  function moveTo(left: number, top: number): void {
    const clamped = clampToViewport(left, top);
    container.style.left = `${clamped.left}px`;
    container.style.top = `${clamped.top}px`;
  }

  const onMouseDown = (e: MouseEvent | TouchEvent) => {
    // モバイル（小画面）ではドラッグ無効
    if (window.innerWidth <= DRAG_MIN_VIEWPORT_WIDTH) return;

    // ヘッダー内のランチャー以外のボタンをクリックした場合はドラッグしない
    const target = e.target as HTMLElement;
    if (
      target.closest("button") &&
      target.closest("button") !== launcherBtn
    ) {
      return;
    }

    isDragging = false; // 開始時にリセット
    onDragStateChange(false);

    const clientX =
      e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
    const clientY =
      e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;

    dragStartX = clientX;
    dragStartY = clientY;

    const rect = container.getBoundingClientRect();
    containerPosX = rect.left;
    containerPosY = rect.top;

    const onMouseMove = (moveEv: MouseEvent | TouchEvent) => {
      const moveX =
        moveEv instanceof MouseEvent
          ? moveEv.clientX
          : moveEv.touches[0].clientX;
      const moveY =
        moveEv instanceof MouseEvent
          ? moveEv.clientY
          : moveEv.touches[0].clientY;

      const deltaX = moveX - dragStartX;
      const deltaY = moveY - dragStartY;

      if (
        !isDragging &&
        (Math.abs(deltaX) > DRAG_THRESHOLD_PX || Math.abs(deltaY) > DRAG_THRESHOLD_PX)
      ) {
        isDragging = true;
        hasMoved = true;
        onDragStateChange(true);
        // ドラッグ開始時に bottom/right 制約を解除して top/left に切り替える
        container.style.bottom = "auto";
        container.style.right = "auto";
      }

      if (isDragging) {
        // タッチでのドラッグ中はページ自体がスクロールしないようにする
        if (moveEv.cancelable) moveEv.preventDefault();
        moveTo(containerPosX + deltaX, containerPosY + deltaY);
      }
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchmove", onMouseMove);
      document.removeEventListener("touchend", onMouseUp);
      document.removeEventListener("touchcancel", onMouseUp);

      if (!isDragging) return;

      // click は mouseup の直後に発火する。ランチャーの click ハンドラは
      // ドラッグ直後の開閉を抑止するため isDragging を見るので、
      // その判定が終わってから false に戻す。ここで即座に戻すと、
      // ドラッグのたびにチャットが開いてしまう。
      isDragging = false;
      setTimeout(() => onDragStateChange(false), 0);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    // preventDefault を呼ぶため passive にしない
    document.addEventListener("touchmove", onMouseMove, { passive: false });
    document.addEventListener("touchend", onMouseUp);
    // OS にタッチを奪われた場合も後始末する（リスナーが残り続けるのを防ぐ）
    document.addEventListener("touchcancel", onMouseUp);
  };

  // 画面サイズが変わると、移動済みの位置が画面外に出ることがある
  const onResize = () => {
    if (!hasMoved) return;
    const rect = container.getBoundingClientRect();
    moveTo(rect.left, rect.top);
  };

  // 各ハンドルにイベントリスナーを登録
  handles.forEach((handle) => {
    handle.addEventListener("mousedown", onMouseDown);
    handle.addEventListener("touchstart", onMouseDown, { passive: true });
  });
  window.addEventListener("resize", onResize);

  // クリーンアップ関数
  return () => {
    handles.forEach((handle) => {
      handle.removeEventListener("mousedown", onMouseDown);
      handle.removeEventListener("touchstart", onMouseDown);
    });
    window.removeEventListener("resize", onResize);
  };
}
