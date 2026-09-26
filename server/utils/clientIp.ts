import { ipKeyGenerator } from "express-rate-limit";

/** IPv6 をまとめる単位。express-rate-limit の既定値と揃える。 */
const IPV6_SUBNET = 56;

/**
 * X-Forwarded-For からクライアント IP を求める。
 *
 * XFF は「client, proxy1, proxy2」の順で左から追記される。
 * 左端はクライアントが自由に詐称できるため、接続数制限の鍵に使うと制限を回避されたり、他人の IP を名乗って正規ユーザーを締め出せてしまう。
 * 信頼できるのは自分の手前のプロキシが追記した値だけなので、右から trustedProxyCount ホップ分だけ遡った要素を採用する（Express の `trust proxy: 1` と同じ考え方）。
 */
export function resolveClientIp(
  forwardedFor: string | string[] | undefined,
  remoteAddress: string,
  trustedProxyCount = 1,
): string {
  if (!forwardedFor) return remoteAddress;

  const raw = Array.isArray(forwardedFor)
    ? forwardedFor.join(",")
    : forwardedFor;

  const hops = raw
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);

  if (hops.length === 0) return remoteAddress;

  // 右端は直近プロキシが追記した値。そこから trustedProxyCount ホップ分だけ左へ。
  const index = hops.length - trustedProxyCount;
  return hops[Math.max(index, 0)] ?? remoteAddress;
}

/**
 * レート制限や接続数制限のキーに使う形へ正規化する。
 *
 * IPv6 はひとりの利用者が /64 を丸ごと持っていることが普通で、アドレスそのものをキーにすると送信元を変えるだけで上限を回避できる。
 * express-rate-limit と同じく /56 単位にまとめる（IPv4 はそのまま、IPv4 射影アドレスは IPv4 に戻る）。
 */
export function toRateLimitKey(ip: string): string {
  try {
    return ipKeyGenerator(ip, IPV6_SUBNET);
  } catch {
    // 解析できない値はそのままキーにする（未知の形式でも上限は効かせる）
    return ip;
  }
}
