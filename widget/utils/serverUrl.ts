export interface ResolveServerUrlOptions {
  /** 評価中の script 要素（省略時は document.currentScript） */
  currentScript?: Element | null;
  /** currentScript が使えない場合に走査する script 要素群（省略時は document 内の script[src]） */
  scripts?: ArrayLike<HTMLScriptElement>;
  /** 最終フォールバックの origin（省略時は window.location.origin） */
  fallbackOrigin?: string;
}

/**
 * widget.js を読み込んだ <script> タグから Socket.io サーバーの origin を導出する。
 *
 * 埋め込み先サイトの origin にはバックエンドが存在しないため、
 * `window.location.origin` ではなくスクリプトの配信元（= バックエンドの
 * Cloud Run URL）へ接続する必要がある。
 *
 * 解決順序:
 * 1. script タグの `data-server-url` 属性（明示指定）
 * 2. script タグ自身の src の origin
 * 3. ページの origin（/demo や直接 initChatWidget() 呼び出しの互換維持）
 */
export function resolveServerUrl(
  options: ResolveServerUrlOptions = {},
): string {
  const script = findWidgetScript(options);

  if (script) {
    // パス付きの URL を io() に渡すと Socket.io の namespace として解釈され、
    // `${serverUrl}/health` 等の fetch も壊れるため、origin のみに正規化する。
    const explicit = parseOrigin(script.getAttribute("data-server-url"));
    if (explicit) {
      return explicit;
    }

    // .src プロパティはブラウザが絶対 URL に解決済みのため、相対パス読み込み
    // （/demo など）でもページ origin が得られる。
    const fromSrc = parseOrigin(script.src);
    if (fromSrc) {
      return fromSrc;
    }
  }

  return options.fallbackOrigin ?? window.location.origin;
}

function findWidgetScript(
  options: ResolveServerUrlOptions,
): HTMLScriptElement | null {
  const current = options.currentScript ?? document.currentScript;
  if (current instanceof HTMLScriptElement) {
    return current;
  }

  // async 属性付きの動的挿入やコールバック内実行では currentScript が null に
  // なるため、widget.js を指す script タグを走査する。重複埋め込み時は
  // 最後に追加されたタグ（後勝ち）を採用する。
  const scripts =
    options.scripts ??
    document.querySelectorAll<HTMLScriptElement>("script[src]");
  for (let i = scripts.length - 1; i >= 0; i--) {
    const candidate = scripts[i];
    try {
      if (new URL(candidate.src).pathname.endsWith("/widget.js")) {
        return candidate;
      }
    } catch {
      // 不正な src は無視して次の候補へ
    }
  }
  return null;
}

function parseOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
