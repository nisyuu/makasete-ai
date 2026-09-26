/**
 * クライアント単位の同時接続数を数える。
 *
 * 数え上げを「加算」と「解放」の対で扱い、解放は必ず一度だけ行われるようにする。
 * Socket.IO のミドルウェアで加算し、disconnect で減算する素朴な実装だと、ミドルウェアを通った直後に接続が閉じた場合に connection も disconnect も発火せず（socket.io は readyState を見て socket を捨てる）、加算した分が永久に残る。
 * 数回繰り返すだけでその IP は接続できなくなるため、解放は呼び出し側が受け取る関数に閉じ込める。
 */
export class ConnectionCounter {
  private readonly counts = new Map<string, number>();

  constructor(private readonly limit: number) {}

  /**
   * 1 接続ぶん数える。
   * 上限に達していれば null を返す。
   * 戻り値の関数を呼ぶと解放する（複数回呼んでも二重に減らない）。
   */
  acquire(key: string): (() => void) | null {
    const count = this.counts.get(key) ?? 0;
    if (count >= this.limit) return null;

    this.counts.set(key, count + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.counts.get(key);
      if (current === undefined) return;
      if (current <= 1) this.counts.delete(key);
      else this.counts.set(key, current - 1);
    };
  }

  /** 現在の接続数（テストと監視用） */
  count(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  /** 追跡中のキー数（リーク検知用） */
  size(): number {
    return this.counts.size;
  }
}
