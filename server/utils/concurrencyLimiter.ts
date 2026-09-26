/**
 * プロセス全体で同時に走らせる処理の数を抑える。
 *
 * 応答生成は 1 件ごとに LLM のストリームと文単位の TTS を呼び、そのまま課金につながる。
 * IP 単位のレート制限はクライアントを正しく識別できて初めて機能するので、識別に失敗しても効く歯止めとして「同時に走る本数」を別に抑える。
 */
export class ConcurrencyLimiter {
  private active = 0;

  constructor(private readonly limit: number) {}

  /**
   * 1 枠を確保する。
   * 空きが無ければ null を返す。
   * 戻り値の関数を呼ぶと解放する（複数回呼んでも二重に減らない）。
   */
  tryAcquire(): (() => void) | null {
    if (this.active >= this.limit) return null;
    this.active += 1;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }

  /** 現在の使用数（テストと監視用） */
  activeCount(): number {
    return this.active;
  }
}
