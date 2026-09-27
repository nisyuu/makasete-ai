import { initChatWidget } from "./widget";
import { resolveServerUrl } from "./utils/serverUrl";

/**
 * ウィジェットを取り外す。IIFE ビルドでは `window.MakaseteAIWidget.destroy()` として
 * 公開され、SPA でウィジェットが不要になったときにソケットや音声を解放できる。
 */
export const destroy = initChatWidget({
  // トップレベルの同期呼び出しを維持する（script 評価中でないと
  // document.currentScript から配信元 origin を導出できない）。
  serverUrl: resolveServerUrl(),
  language: "ja",
});
