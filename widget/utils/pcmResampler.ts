/**
 * PCM の断片を、前後の断片とつながったまま別のサンプルレートへ変換する（線形補間）。
 *
 * 24kHz の断片をそのまま AudioBuffer にすると、出力のサンプルレートへの変換がブラウザ任せで断片ごとに独立して行われる。
 * iOS Safari では継ぎ目で波形が途切れ、数十ミリ秒ごとの継ぎ目がプツプツという雑音として声に乗る。
 * 直前の断片の最後のサンプルと補間位置を持ち越し、断片の境目をまたいでも1本の波形として変換する。
 */
export interface PcmResampler {
  /** 断片を変換する。変換後の長さは入力と比例しない（端数は次の断片に持ち越す）。 */
  process: (input: Float32Array, inRate: number, outRate: number) => Float32Array;
  /** 持ち越し分を捨てる。応答の切り替えなど、前の断片とつながらないときに呼ぶ。 */
  reset: () => void;
}

export function createPcmResampler(): PcmResampler {
  // 直前の断片の最後のサンプル。次の断片の先頭との間を補間するために残す。
  let tail: number | null = null;
  // 次に出力するサンプルの位置（tail を 0 番目とした入力サンプル単位）
  let position = 0;
  let lastInRate = 0;
  let lastOutRate = 0;

  function reset(): void {
    tail = null;
    position = 0;
  }

  function process(input: Float32Array, inRate: number, outRate: number): Float32Array {
    if (inRate !== lastInRate || outRate !== lastOutRate) {
      reset();
      lastInRate = inRate;
      lastOutRate = outRate;
    }
    if (inRate === outRate) return input;
    if (input.length === 0) return input;

    const source = tail === null ? input : new Float32Array(input.length + 1);
    if (tail !== null) {
      source[0] = tail;
      source.set(input, 1);
    }

    const step = inRate / outRate;
    const last = source.length - 1;
    const output = new Float32Array(Math.max(0, Math.ceil((last - position) / step)) + 1);
    let count = 0;
    // 補間には i と i + 1 の2点が要る。i + 1 が届いていない分は次の断片で出力する。
    while (Math.floor(position) < last) {
      const i = Math.floor(position);
      const frac = position - i;
      output[count++] = source[i] + (source[i + 1] - source[i]) * frac;
      position += step;
    }

    tail = source[last];
    position -= last;
    return output.subarray(0, count);
  }

  return { process, reset };
}
