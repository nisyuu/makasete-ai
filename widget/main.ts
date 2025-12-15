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
                <span>AI書店員 福蔵</span>
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
        </div>
        <button class="launcher-button">
            <span>福蔵に聞いてみる</span>
        </button>
    `;
    shadow.appendChild(container);

    // Use production URL unless on localhost
    const serverUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:8080'
        : 'https://ec-voice-bot-o6mypnfjrq-an.a.run.app';

    new ChatWidget(shadow, serverUrl);
})();
