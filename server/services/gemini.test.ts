import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSystemInstruction, generateResponse } from "./gemini";

vi.mock("@google/generative-ai", () => {
  const mockSendMessage = vi.fn().mockResolvedValue({
    response: { text: () => "Hello! How can I help you?" },
  });

  const mockStartChat = vi.fn().mockReturnValue({
    sendMessage: mockSendMessage,
  });

  const mockGetGenerativeModel = vi.fn().mockReturnValue({
    startChat: mockStartChat,
  });

  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: mockGetGenerativeModel,
    })),
  };
});

describe("buildSystemInstruction", () => {
  it("returns default instruction when no config provided", () => {
    const result = buildSystemInstruction({});
    expect(result).toContain("helpful assistant");
  });

  it("includes business name when provided", () => {
    const result = buildSystemInstruction({ businessName: "Acme Corp" });
    expect(result).toContain("Acme Corp");
  });

  it("includes system prompt when provided", () => {
    const result = buildSystemInstruction({
      systemPrompt: "Always be concise.",
    });
    expect(result).toContain("Always be concise.");
  });

  it("includes both business name and system prompt", () => {
    const result = buildSystemInstruction({
      businessName: "Acme Corp",
      systemPrompt: "Always be concise.",
    });
    expect(result).toContain("Acme Corp");
    expect(result).toContain("Always be concise.");
  });
});

describe("generateResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns response text from the model", async () => {
    const messages = [{ role: "user" as const, content: "Hello" }];
    const result = await generateResponse(messages);
    expect(result).toBe("Hello! How can I help you?");
  });

  it("handles conversation history correctly", async () => {
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there!" },
      { role: "user" as const, content: "How are you?" },
    ];
    const result = await generateResponse(messages);
    expect(result).toBe("Hello! How can I help you?");
  });
});
