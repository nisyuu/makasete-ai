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

  const onMouseDown = (e: MouseEvent | TouchEvent) => {
    // モバイル（小画面）ではドラッグ無効
    if (window.innerWidth <= 600) return;

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

      if (!isDragging && (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5)) {
        isDragging = true;
        onDragStateChange(true);
        // ドラッグ開始時に bottom/right 制約を解除して top/left に切り替える
        container.style.bottom = "auto";
        container.style.right = "auto";
      }

      if (isDragging) {
        container.style.left = `${containerPosX + deltaX}px`;
        container.style.top = `${containerPosY + deltaY}px`;
      }
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchmove", onMouseMove);
      document.removeEventListener("touchend", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("touchmove", onMouseMove);
    document.addEventListener("touchend", onMouseUp);
  };

  // 各ハンドルにイベントリスナーを登録
  handles.forEach((handle) => {
    handle.addEventListener("mousedown", onMouseDown);
    handle.addEventListener("touchstart", onMouseDown, { passive: true });
  });

  // クリーンアップ関数
  return () => {
    handles.forEach((handle) => {
      handle.removeEventListener("mousedown", onMouseDown);
      handle.removeEventListener("touchstart", onMouseDown);
    });
  };
}
