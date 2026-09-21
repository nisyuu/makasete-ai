/**
 * プロセス全体の最終防衛ハンドラ。
 *
 * unhandledRejection と uncaughtException は性質が違うため扱いを分ける。
 *
 * - unhandledRejection: Promise の reject を誰も拾わなかっただけで、同期処理の
 *   途中でスタックが巻き戻ったわけではない。プロセスの状態は壊れていないので、
 *   ログを残して継続する。ここで落とすと、reject を拾い損ねた経路が一つでも
 *   あれば「1 リクエストでサーバーが落ちる」DoS に戻ってしまう。
 *
 * - uncaughtException: 同期処理の途中で例外が突き抜けており、途中までしか
 *   更新されていない状態（ロック、カウンタ、ストリーム）が残っている可能性がある。
 *   そのまま動かし続けるのは安全ではないため、ログを残し、処理中の接続を
 *   閉じてから終了する。Cloud Run がコンテナを再起動する。
 */

/** 終了処理で閉じる対象（http.Server など） */
export interface ClosableServer {
  close(callback?: (err?: Error) => void): unknown;
}

export interface ProcessLike {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
  on(event: "uncaughtException", listener: (error: Error) => void): unknown;
  exit(code?: number): never | void;
}

export interface ProcessHandlerOptions {
  /** 終了前に閉じるサーバー */
  server?: ClosableServer;
  /** close が終わらない場合に強制終了するまでの猶予（ミリ秒） */
  shutdownTimeoutMs?: number;
  logger?: Pick<Console, "error">;
  /** テスト用にタイマーを差し替える */
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  return String(value);
}

export function installProcessHandlers(
  proc: ProcessLike,
  options: ProcessHandlerOptions = {},
): void {
  const logger = options.logger ?? console;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5000;
  const setTimer =
    options.setTimer ??
    ((fn: () => void, ms: number) => setTimeout(fn, ms));
  let shuttingDown = false;

  proc.on("unhandledRejection", (reason: unknown) => {
    logger.error("[Process] Unhandled rejection:", describe(reason));
  });

  proc.on("uncaughtException", (error: Error) => {
    logger.error("[Process] Uncaught exception, shutting down:", describe(error));

    // 終了処理中にさらに例外が来ても、二重に終了処理を走らせない
    if (shuttingDown) return;
    shuttingDown = true;

    // close が終わらない（長時間接続が残っている）場合でも必ず終了する
    const timer = setTimer(() => proc.exit(1), shutdownTimeoutMs);
    timer.unref?.();

    if (!options.server) {
      proc.exit(1);
      return;
    }

    options.server.close(() => proc.exit(1));
  });
}
