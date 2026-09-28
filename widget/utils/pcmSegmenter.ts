/**
 * 溜めた PCM を区切る位置を決める。
 *
 * iOS Safari は、短い AudioBuffer を時刻指定で隙間なく並べると継ぎ目ごとにプツッと鳴る。
 * 数十ミリ秒の断片をそのまま並べると、継ぎ目が1秒に数十回あって声に雑音が乗って聞こえる。
 * 断片を大きな区間にまとめて継ぎ目を減らし、継ぎ目は発話の合間（無音に近い所）に置いて目立たなくする。
 *
 * from 以降で、windowSize ごとに区切った窓を末尾から見ていく。
 * ピークが quietPeak 未満の窓があれば、その中央で区切る。
 * 無ければ、いちばん静かな窓の中央で区切る。
 * from 以降に窓が1つも取れないときは末尾（全部）を返す。
 */
export function findCutPoint(
  samples: Float32Array,
  from: number,
  windowSize: number,
  quietPeak: number,
): number {
  let quietestCenter = samples.length;
  let quietestPeak = Infinity;
  for (let end = samples.length; end - windowSize >= from; end -= windowSize) {
    let peak = 0;
    for (let i = end - windowSize; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
    const center = end - Math.floor(windowSize / 2);
    if (peak < quietPeak) return center;
    if (peak < quietestPeak) {
      quietestPeak = peak;
      quietestCenter = center;
    }
  }
  return quietestCenter;
}
