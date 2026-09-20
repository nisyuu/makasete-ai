/**
 * Socket.IO イベント用のトークンバケット。
 *
 * express-rate-limit は Express のミドルウェアチェーンにしか効かない。engine.io は
 * `removeAllListeners("request")` で /socket.io を Express より先に横取りするため、
 * Socket.IO 経由の user-input は HTTP のレート制限を一切通らない。1 イベントごとに
 * LLM ストリーム 1 回と文単位の TTS 呼び出しが走り、そのまま課金されるので、
 * ソケット側に独自の制限を置く。
 */
export interface TokenBucketOptions {
  /** バケットの最大トークン数（バースト許容量） */
  capacity: number;
  /** 1 秒あたりに回復するトークン数 */
  refillPerSecond: number;
  /** 現在時刻を返す関数（テスト用に差し替え可能） */
  now?: () => number;
}

interface BucketState {
  tokens: number;
  updatedAt: number;
}

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;

  constructor(options: TokenBucketOptions) {
    this.capacity = options.capacity;
    this.refillPerSecond = options.refillPerSecond;
    this.now = options.now ?? Date.now;
  }

  /**
   * トークンを 1 つ消費できれば true、枯渇していれば false を返す。
   */
  tryConsume(key: string): boolean {
    const now = this.now();
    const state = this.buckets.get(key) ?? {
      tokens: this.capacity,
      updatedAt: now,
    };

    const elapsedSeconds = Math.max(now - state.updatedAt, 0) / 1000;
    const tokens = Math.min(
      this.capacity,
      state.tokens + elapsedSeconds * this.refillPerSecond,
    );

    if (tokens < 1) {
      this.buckets.set(key, { tokens, updatedAt: now });
      return false;
    }

    this.buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    return true;
  }

  /** 切断時などにキーを破棄する（バケットの無制限な蓄積を防ぐ） */
  release(key: string): void {
    this.buckets.delete(key);
  }

  /** 満タンに戻ったバケットを削除する。定期的に呼んでメモリを解放する。 */
  prune(): void {
    const now = this.now();
    for (const [key, state] of this.buckets) {
      const elapsedSeconds = Math.max(now - state.updatedAt, 0) / 1000;
      if (
        state.tokens + elapsedSeconds * this.refillPerSecond >=
        this.capacity
      ) {
        this.buckets.delete(key);
      }
    }
  }
}
