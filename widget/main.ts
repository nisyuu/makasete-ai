import { initChatWidget } from './widget';

initChatWidget({
  serverUrl: window.location.origin,
  title: 'Chat Assistant',
  placeholder: 'Type a message...',
});
