import styles from './styles.css?inline';
import { ChatWidget } from './widget';

(function () {
    const hostId = 'ec-voice-widget-root';
    if (document.getElementById(hostId)) return;

    const host = document.createElement('div');
    host.id = hostId;
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    const styleSheet = document.createElement('style');
    styleSheet.textContent = styles;
    shadow.appendChild(styleSheet);

    const container = document.createElement('div');
    container.className = 'widget-container';
    container.innerHTML = `
        <div class="chat-window">
             <div class="chat-header">
                <span>AI店員</span>
                <div class="header-controls">
                    <button class="audio-toggle-btn" title="音声読み上げOFF">
                        <span class="audio-icon">🔇</span>
                        <span class="audio-text">音声: OFF</span>
                    </button>
                    <button class="close-btn">×</button>
                </div>
             </div>
             <div class="chat-timeline"></div>
             <div class="input-area">
                 <button class="btn mic-btn" title="通話モード">📞</button>
                 <div class="input-wrapper">
                    <textarea class="text-input" placeholder="質問を入力..." rows="1"></textarea>
                    <div class="input-helper">Command(Ctrl) + Enterで送信</div>
                 </div>
                 <button class="btn send-btn" title="送信">➤</button>
             </div>
             <div class="loading-overlay">
                <div class="spinner"></div>
                <div class="loading-text">準備中です。少々お待ちください...</div>
             </div>
        </div>
        <button class="launcher-button">
            <span>AI店員に聞いてみる</span>
        </button>
    `;
    shadow.appendChild(container);

    // Determine server URL from the script's own source (currentScript)
    // This allows the widget to automatically connect back to the server it was served from.
    let serverUrl = import.meta.env.VITE_SERVER_URL || '';

    if (!serverUrl) {
        const scriptTag = document.currentScript as HTMLScriptElement;
        if (scriptTag && scriptTag.src) {
            const url = new URL(scriptTag.src);
            serverUrl = url.origin;
        } else {
            // Fallback: search for the script tag by its filename
            const scripts = document.getElementsByTagName('script');
            for (let i = 0; i < scripts.length; i++) {
                const src = scripts[i].src;
                if (src && src.includes('widget.js')) {
                    serverUrl = new URL(src).origin;
                    break;
                }
            }
        }
    }

    // Last resort fallback for local development
    if (!serverUrl && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        serverUrl = 'http://localhost:8080';
    }

    if (!serverUrl) {
        console.error('MakaseteBot: Could not determine server URL.');
    }

    new ChatWidget(shadow, serverUrl);
})();
