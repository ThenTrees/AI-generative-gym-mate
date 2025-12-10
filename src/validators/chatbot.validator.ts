import { z } from "zod";

export const chatBodySchema = z.object({
  message: z.string().min(1, "Message is required"),
  userId: z.string().optional(),
  conversationId: z.string().optional(),
  context: z.any().optional(),
});

export const conversationParamsSchema = z.object({
  conversationId: z.string().min(1, "conversationId is required"),
});

