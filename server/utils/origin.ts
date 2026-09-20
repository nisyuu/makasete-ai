/**
 * ALLOWED_ORIGINS の解析と Origin 照合。
 *
 * CORS ミドルウェアは Origin が一致しなくてもヘッダを付けずに通すだけで接続を
 * 拒否しない。Socket.IO の WebSocket 直結（`transports: ["websocket"]`）は
 * engine.io が Origin を検証しないため、`allowRequest` でこの関数を使って
 * ハンドシェイク自体を拒否する。
 */

/** `*`（全 origin 許可）を表す番兵 */
export const ALLOW_ALL_ORIGINS = "*";

/**
 * ALLOWED_ORIGINS 環境変数を origin のリストへ解析する。
 * カンマ区切りの各要素は trim し、空要素は捨てる。
 * 未設定・空・`*` を含む場合は `"*"`（全許可）を返す。
 */
export function parseAllowedOrigins(
  raw: string | undefined,
): string[] | typeof ALLOW_ALL_ORIGINS {
  if (!raw) return ALLOW_ALL_ORIGINS;

  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0 || origins.includes(ALLOW_ALL_ORIGINS)) {
    return ALLOW_ALL_ORIGINS;
  }

  return origins;
}

/**
 * Origin ヘッダが許可リストに含まれるかを判定する。
 *
 * Origin ヘッダが無いリクエスト（同一 origin の fetch、curl、サーバー間通信）は
 * ブラウザの CORS 制約の対象外なので許可する。ここで防ぎたいのは「第三者サイトに
 * 埋め込まれたブラウザからの接続」であり、それは必ず Origin を送る。
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowed: string[] | typeof ALLOW_ALL_ORIGINS,
): boolean {
  if (allowed === ALLOW_ALL_ORIGINS) return true;
  if (!origin) return true;
  return allowed.includes(origin);
}
