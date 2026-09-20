/**
 * X-Forwarded-For からクライアント IP を求める。
 *
 * XFF は「client, proxy1, proxy2」の順で左から追記される。左端はクライアントが
 * 自由に詐称できるため、接続数制限の鍵に使うと制限を回避されたり、他人の IP を
 * 名乗って正規ユーザーを締め出せてしまう。信頼できるのは自分の手前のプロキシが
 * 追記した値だけなので、右から trustedProxyCount ホップ分だけ遡った要素を採用する
 * （Express の `trust proxy: 1` と同じ考え方）。
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
