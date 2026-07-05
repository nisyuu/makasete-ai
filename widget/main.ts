import { initChatWidget } from "./widget";
import { resolveServerUrl } from "./utils/serverUrl";

initChatWidget({
  // トップレベルの同期呼び出しを維持する（script 評価中でないと
  // document.currentScript から配信元 origin を導出できない）。
  serverUrl: resolveServerUrl(),
  language: "ja",
});
