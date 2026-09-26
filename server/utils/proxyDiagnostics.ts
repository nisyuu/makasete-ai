/**
 * 本番の X-Forwarded-For の形を確認するための診断ログ。
 *
 * 信頼するプロキシ段数（TRUSTED_PROXY_COUNT）が実際の構成と合っていないと、全利用者が同じキーにまとめられ、同時接続やレート制限の上限をサイト全体で共有してしまう。
 * 構成はコードからは判断できないため、一度だけ実物を見る。
 *
 * ログを出しすぎないよう回数に上限を設け、既定では無効にしている。
 */

export interface ForwardedForShape {
  /** XFF に並んでいるホップ数（ヘッダが無ければ 0） */
  hopCount: number;
  /** 各ホップ（左から右）。左端はクライアントが詐称できる */
  hops: string[];
  /** 設定した段数で解決したキー */
  resolved: string;
}

export function describeForwardedFor(
  forwardedFor: string | string[] | undefined,
  resolved: string,
): ForwardedForShape {
  const raw = Array.isArray(forwardedFor)
    ? forwardedFor.join(",")
    : (forwardedFor ?? "");

  const hops = raw
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);

  return { hopCount: hops.length, hops, resolved };
}

export interface ProxyLoggerOptions {
  /** 何件までログに出すか */
  limit?: number;
  /** 期待しているホップ数（これと違えば注意を促す） */
  expectedHopCount: number;
  logger?: Pick<Console, "warn" | "info">;
}

/**
 * 診断ログを出す関数を返す。上限に達したら以後は何もしない。
 */
export function createProxyHeaderLogger(options: ProxyLoggerOptions) {
  const limit = options.limit ?? 10;
  const logger = options.logger ?? console;
  let remaining = limit;

  return function logProxyHeaders(
    source: string,
    forwardedFor: string | string[] | undefined,
    resolved: string,
  ): void {
    if (remaining <= 0) return;
    remaining -= 1;

    const shape = describeForwardedFor(forwardedFor, resolved);
    const detail =
      `[proxy] ${source} hops=${shape.hopCount} ` +
      `chain=${JSON.stringify(shape.hops)} resolvedKey=${resolved}`;

    if (shape.hopCount === options.expectedHopCount) {
      logger.info(detail);
      return;
    }

    // ホップ数が想定と違う = TRUSTED_PROXY_COUNT の設定を見直す必要がある
    logger.warn(
      `${detail} — expected hops=${options.expectedHopCount}. ` +
      `Set TRUSTED_PROXY_COUNT to the number of proxies in front of this server, ` +
      `otherwise every visitor shares one rate-limit key.`,
    );
  };
}
