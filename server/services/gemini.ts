import { GoogleGenerativeAI } from "@google/generative-ai";
import { type Message } from "../schema";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

export function buildSystemInstruction(config: {
  businessName?: string;
  systemPrompt?: string;
}): string {
  const parts: string[] = [];

  if (config.businessName) {
    parts.push(`You are a helpful assistant for ${config.businessName}.`);
  } else {
    parts.push("You are a helpful assistant.");
  }

  if (config.systemPrompt) {
    parts.push(config.systemPrompt);
  }

  return parts.join("\n\n");
}

export async function generateResponse(
  messages: Message[],
  config: {
    businessName?: string;
    systemPrompt?: string;
  } = {}
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: buildSystemInstruction(config),
  });

  const history = messages.slice(0, -1).map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.content }],
  }));

  const lastMessage = messages[messages.length - 1];

  const chat = model.startChat({ history });
  const result = await chat.sendMessage(lastMessage.content);
  return result.response.text();
}

export async function generateResponseStream(
  messages: Message[],
  config: {
    businessName?: string;
    systemPrompt?: string;
  } = {}
): Promise<AsyncIterable<string>> {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: buildSystemInstruction(config),
  });

  const history = messages.slice(0, -1).map((msg) => ({
    role: msg.role === "user" ? "user" : "model",
    parts: [{ text: msg.content }],
  }));

  const lastMessage = messages[messages.length - 1];

  const chat = model.startChat({ history });
  const result = await chat.sendMessageStream(lastMessage.content);

  async function* streamText(): AsyncIterable<string> {
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield text;
      }
    }
  }

  return streamText();
}
