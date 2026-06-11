import { initSocketHandler, SocketHandler } from './utils/socketHandler';
import { initAudioHandler, AudioHandler } from './utils/audioHandler';

interface WidgetConfig {
  serverUrl?: string;
  title?: string;
  placeholder?: string;
  language?: 'ja' | 'en';
}

export function initChatWidget(config: WidgetConfig = {}): void {
  const {
    serverUrl = window.location.origin,
    title = 'Chat Assistant',
    placeholder = 'Type a message...',
    language = 'ja',
  } = config;

  // Shadow DOM for style isolation
  const host = document.createElement('div');
  host.id = 'makasete-ai-widget-host';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  // Styles
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 350px;
      height: 500px;
      display: flex;
      flex-direction: column;
      border: 1px solid #ccc;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-family: sans-serif;
      background: white;
      z-index: 2147483647;
    }
    .header {
      background: #4f46e5;
      color: white;
      padding: 12px 16px;
      font-weight: bold;
      font-size: 16px;
      cursor: move;
      user-select: none;
    }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: #f9fafb;
    }
    .msg {
      max-width: 80%;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 14px;
      line-height: 1.4;
      word-wrap: break-word;
      white-space: pre-wrap;
    }
    .msg.user {
      align-self: flex-end;
      background: #4f46e5;
      color: white;
      margin-left: auto;
    }
    .msg.assistant {
      align-self: flex-start;
      background: white;
      color: #111827;
      border: 1px solid #e5e7eb;
    }
    .input-area {
      display: flex;
      padding: 8px;
      border-top: 1px solid #e5e7eb;
      background: white;
      gap: 8px;
    }
    input[type="text"] {
      flex: 1;
      padding: 8px 12px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 14px;
      outline: none;
    }
    input[type="text"]:disabled { background: #f3f4f6; }
    button {
      padding: 8px 16px;
      background: #4f46e5;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    button:disabled { background: #a5b4fc; cursor: not-allowed; }
    button.mic { background: #10b981; }
    button.mic.recording { background: #ef4444; }
  `;
  shadow.appendChild(style);

  // Container
  const container = document.createElement('div');
  container.className = 'container';

  const header = document.createElement('div');
  header.className = 'header';
  header.textContent = title;

  const messagesArea = document.createElement('div');
  messagesArea.className = 'messages';

  const inputArea = document.createElement('div');
  inputArea.className = 'input-area';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;

  const sendBtn = document.createElement('button');
  sendBtn.textContent = 'Send';

  const micBtn = document.createElement('button');
  micBtn.className = 'mic';
  micBtn.textContent = '🎤';

  inputArea.appendChild(input);
  inputArea.appendChild(micBtn);
  inputArea.appendChild(sendBtn);
  container.appendChild(header);
  container.appendChild(messagesArea);
  container.appendChild(inputArea);
  shadow.appendChild(container);

  // --- Helpers ---

  function addMessage(role: 'user' | 'assistant', text: string): HTMLDivElement {
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.textContent = text;
    messagesArea.appendChild(div);
    messagesArea.scrollTop = messagesArea.scrollHeight;
    return div;
  }

  function setInputLocked(locked: boolean): void {
    input.disabled = locked;
    sendBtn.disabled = locked;
  }

  let currentAssistantDiv: HTMLDivElement | null = null;

  // --- Audio ---
  const audio: AudioHandler = initAudioHandler({
    onTranscript: (text) => {
      input.value = text;
      sendMessage(true);
    },
    onRecordingEnd: () => {
      micBtn.classList.remove('recording');
    },
    language,
  });

  // --- Socket ---
  const socket: SocketHandler = initSocketHandler({
    serverUrl,
    onTextChunk: (content) => {
      if (!currentAssistantDiv) {
        currentAssistantDiv = addMessage('assistant', '');
      }
      currentAssistantDiv.textContent += content;
      messagesArea.scrollTop = messagesArea.scrollHeight;
    },
    onAudioChunk: (data) => {
      if (data.type === 'text') {
        if (!currentAssistantDiv) {
          currentAssistantDiv = addMessage('assistant', '');
        }
        currentAssistantDiv.textContent += (data.content as string);
        messagesArea.scrollTop = messagesArea.scrollHeight;
      } else if (data.type === 'audio') {
        audio.handleAudioChunk(data.content);
      }
    },
    onError: (message) => {
      addMessage('assistant', `Error: ${message}`);
      setInputLocked(false);
      currentAssistantDiv = null;
    },
    onResponseComplete: () => {
      setInputLocked(false);
      currentAssistantDiv = null;
      input.focus();
    },
    onConnect: () => {
      console.log('[MakaseteAI] Connected');
    },
  });

  // --- Send ---
  function sendMessage(isVoiceInput = false): void {
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    setInputLocked(true);
    currentAssistantDiv = null;

    addMessage('user', text);

    if (isVoiceInput) {
      audio.resumeAudioContext();
      audio.resetAudioState();
    }

    socket.sendUserInput(text, isVoiceInput, language);
  }

  sendBtn.addEventListener('click', () => sendMessage(false));
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') sendMessage(false);
  });

  micBtn.addEventListener('click', () => {
    if (!audio.isSpeechRecognitionSupported()) {
      alert('音声認識はこのブラウザでは利用できません');
      return;
    }
    audio.initAudioContext();
    audio.toggleRecording();
    micBtn.classList.toggle('recording');
  });

  // --- Drag ---
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('mousedown', (e: MouseEvent) => {
    isDragging = true;
    const rect = container.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
  });

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isDragging) return;
    container.style.right = 'auto';
    container.style.bottom = 'auto';
    container.style.left = `${e.clientX - dragOffsetX}px`;
    container.style.top = `${e.clientY - dragOffsetY}px`;
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}
