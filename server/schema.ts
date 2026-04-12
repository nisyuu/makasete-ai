import { z } from "zod";

export const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

export type Message = z.infer<typeof messageSchema>;

export const chatRequestSchema = z.object({
  messages: z.array(messageSchema).min(1),
  businessName: z.string().optional(),
  systemPrompt: z.string().optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const widgetConfigSchema = z.object({
  businessName: z.string().optional(),
  systemPrompt: z.string().optional(),
  primaryColor: z.string().optional(),
  welcomeMessage: z.string().optional(),
});

export type WidgetConfig = z.infer<typeof widgetConfigSchema>;
