import styles from "./styles.css?inline";
import { ChatWidget } from "./widget";

/** Supported locale codes (must mirror server/config.ts SUPPORTED_LOCALES) */
const SUPPORTED_LOCALES = ['ja', 'en', 'zh-CN'] as const;
type Locale = typeof SUPPORTED_LOCALES[number];

/**
 * Detects the appropriate locale using the following priority:
 * 1. `data-locale` attribute on the script tag
 * 2. `navigator.language` browser setting
 * 3. Default fallback: 'ja'
 */
function detectLocale(): Locale {
  // 1. Check data-locale attribute on the current script tag
  const scriptTag = document.currentScript as HTMLScriptElement | null;
  if (scriptTag) {
    const dataLocale = scriptTag.dataset.locale;
    if (dataLocale && SUPPORTED_LOCALES.includes(dataLocale as Locale)) {
      return dataLocale as Locale;
    }
  }

  // 2. Use browser language
  const browserLang = navigator.language; // e.g. "en-US", "ja", "zh-CN"

  // Exact match first (handles "zh-CN" etc.)
  if (SUPPORTED_LOCALES.includes(browserLang as Locale)) {
    return browserLang as Locale;
  }

  // Prefix match (e.g. "en-GB" -> "en")
  const langPrefix = browserLang.split('-')[0];
  const prefixMatch = SUPPORTED_LOCALES.find(
    (loc) => loc.split('-')[0] === langPrefix,
  );
  if (prefixMatch) {
    return prefixMatch;
  }

  // 3. Default fallback
  return 'ja';
}

(function () {
  const hostId = "makasete-ai-widget-root";
  if (document.getElementById(hostId)) return;

  const host = document.createElement("div");
  host.id = hostId;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });

  const styleSheet = document.createElement("style");
  styleSheet.textContent = styles;
  shadow.appendChild(styleSheet);

  // Detect locale before building the DOM so placeholders can be set correctly
  const locale = detectLocale();

  // Set dir attribute on host for RTL language support
  const rtlLocales: string[] = []; // e.g. ['ar', 'he'] for future RTL support
  const langPrefix = locale.split('-')[0];
  if (rtlLocales.includes(langPrefix)) {
    host.setAttribute('dir', 'rtl');
  }

  const container = document.createElement("div");
  container.className = "widget-container";
  container.innerHTML = `
        <div class="chat-window">
             <div class="chat-header">
                <span class="chat-title">AIアシスタント</span>
                <div class="header-controls">
                    <button class="close-btn" title="閉じる">
                        <svg class="lucide lucide-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                </div>
             </div>
             <div class="chat-timeline"></div>
             <div class="input-area">
                 <div class="input-wrapper">
                    <textarea class="text-input" placeholder="質問を入力..." rows="1"></textarea>
                    <div class="input-helper">Command(Ctrl) + Enterで送信</div>
                 </div>
                 <div class="input-actions">
                    <button class="btn mic-btn" title="音声入力">
                        <svg class="lucide lucide-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                    </button>
                    <button class="btn send-btn" title="送信" style="display: none;">
                        <svg class="lucide lucide-send" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
                    </button>
                 </div>
             </div>
             <div class="widget-footer">Powered by Makasete AI</div>
             <div class="loading-overlay">
                <div class="spinner"></div>
                <div class="loading-text">準備中です。少々お待ちください...</div>
             </div>
        </div>
        <button class="launcher-button" title="AIアシスタントに相談する">
            <svg class="launcher-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 8V4H8"></path>
                <rect width="16" height="12" x="4" y="8" rx="2"></rect>
                <path d="M2 14h2"></path>
                <path d="M20 14h2"></path>
                <path d="M15 13v2"></path>
                <path d="M9 13v2"></path>
            </svg>
        </button>
    `;
  shadow.appendChild(container);

  // Determine server URL from the script's own source (currentScript)
  // This allows the widget to automatically connect back to the server it was served from.
  let serverUrl = import.meta.env.VITE_SERVER_URL || "";

  if (!serverUrl) {
    const scriptTag = document.currentScript as HTMLScriptElement;
    if (scriptTag && scriptTag.src) {
      const url = new URL(scriptTag.src);
      serverUrl = url.origin;
    } else {
      // Fallback: search for the script tag by its filename
      const scripts = document.getElementsByTagName("script");
      for (let i = 0; i < scripts.length; i++) {
        const src = scripts[i].src;
        if (src && src.includes("widget.js")) {
          serverUrl = new URL(src).origin;
          break;
        }
      }
    }
  }

  // Last resort fallback for local development
  if (
    !serverUrl &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
  ) {
    serverUrl = "http://localhost:8080";
  }

  if (!serverUrl) {
    console.error("MakaseteAI: Could not determine server URL.");
  }

  new ChatWidget(shadow, serverUrl, locale);
})();
