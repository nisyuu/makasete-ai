interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface WidgetConfig {
  apiEndpoint?: string;
  title?: string;
  placeholder?: string;
}

export function initChatWidget(config: WidgetConfig = {}): void {
  const {
    apiEndpoint = '/api/chat',
    title = 'Chat Assistant',
    placeholder = 'Type a message...',
  } = config;

  // Create widget container
  const container = document.createElement('div');
  container.id = 'chat-widget-container';
  container.style.cssText = `
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
    z-index: 9999;
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    background: #4f46e5;
    color: white;
    padding: 12px 16px;
    font-weight: bold;
    font-size: 16px;
  `;
  header.textContent = title;

  // Messages area
  const messagesArea = document.createElement('div');
  messagesArea.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: #f9fafb;
  `;

  // Input area
  const inputArea = document.createElement('div');
  inputArea.style.cssText = `
    display: flex;
    padding: 8px;
    border-top: 1px solid #e5e7eb;
    background: white;
    gap: 8px;
  `;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.style.cssText = `
    flex: 1;
    padding: 8px 12px;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    font-size: 14px;
    outline: none;
  `;

  const sendButton = document.createElement('button');
  sendButton.textContent = 'Send';
  sendButton.style.cssText = `
    padding: 8px 16px;
    background: #4f46e5;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
  `;

  inputArea.appendChild(input);
  inputArea.appendChild(sendButton);

  container.appendChild(header);
  container.appendChild(messagesArea);
  container.appendChild(inputArea);
  document.body.appendChild(container);

  const messages: ChatMessage[] = [];

  function addMessageToUI(role: 'user' | 'assistant', content: string): HTMLDivElement {
    const msgDiv = document.createElement('div');
    msgDiv.style.cssText = `
      max-width: 80%;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 14px;
      line-height: 1.4;
      word-wrap: break-word;
      ${role === 'user'
        ? 'align-self: flex-end; background: #4f46e5; color: white; margin-left: auto;'
        : 'align-self: flex-start; background: white; color: #111827; border: 1px solid #e5e7eb;'
      }
    `;
    msgDiv.textContent = content;
    messagesArea.appendChild(msgDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
    return msgDiv;
  }

  async function sendMessage(): Promise<void> {
    const userText = input.value.trim();
    if (!userText) return;

    input.value = '';
    sendButton.disabled = true;

    messages.push({ role: 'user', content: userText });
    addMessageToUI('user', userText);

    // Add a placeholder for the assistant response
    const assistantDiv = addMessageToUI('assistant', '...');

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      assistantDiv.textContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                assistantText += parsed.text;
                assistantDiv.textContent = assistantText;
                messagesArea.scrollTop = messagesArea.scrollHeight;
              }
            } catch {
              // ignore parse errors for non-JSON lines
            }
          }
        }
      }

      messages.push({ role: 'assistant', content: assistantText });
    } catch (err) {
      assistantDiv.textContent = 'Error: Could not get a response.';
      assistantDiv.style.color = '#dc2626';
      console.error('Chat widget error:', err);
    } finally {
      sendButton.disabled = false;
      input.focus();
    }
  }

  sendButton.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });
}
