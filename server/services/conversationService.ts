import { Conversation, Message } from '../types';

const conversations = new Map<string, Conversation>();

function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

export function createConversation(): Conversation {
  const id = generateId();
  const conversation: Conversation = {
    id,
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  conversations.set(id, conversation);
  return conversation;
}

export function getConversation(id: string): Conversation | undefined {
  return conversations.get(id);
}

export function addMessage(
  conversationId: string,
  message: Message
): Conversation | undefined {
  const conversation = conversations.get(conversationId);
  if (!conversation) {
    return undefined;
  }
  conversation.messages.push(message);
  conversation.updatedAt = new Date();
  return conversation;
}

export function getOrCreateConversation(id?: string): Conversation {
  if (id) {
    const existing = conversations.get(id);
    if (existing) {
      return existing;
    }
  }
  return createConversation();
}

export function deleteConversation(id: string): boolean {
  return conversations.delete(id);
}

export function getAllConversations(): Conversation[] {
  return Array.from(conversations.values());
}
