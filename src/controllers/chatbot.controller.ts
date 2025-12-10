import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import chatbotService from "../services/chatbot.service";
import { logger } from "../utils/logger";
import { sendError, sendSuccess } from "../utils/response";

export class ChatbotController {
  /**
   * @route POST /api/chatbot/chat
   * @desc Send a message to the AI chatbot
   */
  async chat(req: Request, res: Response): Promise<void> {
    try {
      const { message, userId, conversationId, context } = req.body;

      if (!message || typeof message !== "string" || message.trim().length === 0) {
        sendError(res, "Message is required and must be a non-empty string", 400);
        return;
      }

      logger.info(`Chatbot request from user ${userId}: ${message.substring(0, 100)}...`);

      const activeConversationId = conversationId || uuidv4();

      const response = await chatbotService.processMessage({
        message,
        userId,
        conversationId: activeConversationId,
        context
      });

      sendSuccess(res, "Chat processed successfully", response);

    } catch (error: any) {
      logger.error("Error in chatbot chat:", error);
      sendError(
        res,
        "Failed to process your message. Please try again.",
        500,
        process.env.NODE_ENV === "development" ? error.message : undefined
      );
    }
  }

  /**
   * @route POST /api/chatbot/workout-suggestion
   * @desc Get specific workout suggestions based on user message
   */
  async workoutSuggestion(req: Request, res: Response): Promise<void> {
    try {
      const { message, userId, context } = req.body;

      if (!message) {
        sendError(res, "Message is required", 400);
        return;
      }

      logger.info(`Workout suggestion request from user ${userId}`);

      // Use the same processMessage but with workout-specific context
      const response = await chatbotService.processMessage({
        message,
        userId,
        context: {
          ...context,
          intentHint: 'workout_planning'
        }
      });

      sendSuccess(res, "Workout suggestion generated", response);

    } catch (error: any) {
      logger.error("Error generating workout suggestion:", error);
      sendError(res, "Failed to generate workout suggestion. Please try again.", 500);
    }
  }

  /**
   * @route POST /api/chatbot/nutrition-advice
   * @desc Get specific nutrition advice based on user message
   */
  async nutritionAdvice(req: Request, res: Response): Promise<void> {
    try {
      const { message, userId, context } = req.body;

      if (!message) {
        sendError(res, "Message is required", 400);
        return;
      }

      logger.info(`Nutrition advice request from user ${userId}`);

      const response = await chatbotService.processMessage({
        message,
        userId,
        context: {
          ...context,
          intentHint: 'nutrition_planning'
        }
      });

      sendSuccess(res, "Nutrition advice generated", response);

    } catch (error: any) {
      logger.error("Error generating nutrition advice:", error);
      sendError(res, "Failed to generate nutrition advice. Please try again.", 500);
    }
  }

  /**
   * @route GET /api/chatbot/conversation/:conversationId
   * @desc Get conversation history
   */
  async getConversation(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const { userId } = req.query;

      logger.info(`Getting conversation history: ${conversationId} for user ${userId}`);

      const history = await chatbotService.getConversationHistory(conversationId, userId as string);

      sendSuccess(res, "Conversation history retrieved", history);

    } catch (error: any) {
      logger.error("Error getting conversation history:", error);
      sendError(res, "Failed to retrieve conversation history.", 500);
    }
  }

  /**
   * @route DELETE /api/chatbot/conversation/:conversationId
   * @desc Clear conversation history
   */
  async clearConversation(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const { userId } = req.query;

      logger.info(`Clearing conversation: ${conversationId} for user ${userId}`);

      await chatbotService.clearConversation(conversationId, userId as string);

      sendSuccess(res, "Conversation cleared successfully");

    } catch (error: any) {
      logger.error("Error clearing conversation:", error);
      sendError(res, "Failed to clear conversation.", 500);
    }
  }

  /**
   * @route GET /api/chatbot/features
   * @desc Get available chatbot features and capabilities
   */
  async getFeatures(req: Request, res: Response): Promise<void> {
    try {
      sendSuccess(res, "Features retrieved", {
          capabilities: [
            'Workout planning and exercise recommendations',
            'Nutrition advice and meal planning',
            'Fitness motivation and goal setting',
            'Exercise form and technique guidance',
            'Progress tracking insights',
            'General health and wellness tips'
          ],
          supportedLanguages: ['Vietnamese', 'English'],
          features: {
            contextAware: true,
            personalizedAdvice: true,
            workoutGeneration: true,
            nutritionPlanning: true,
            progressTracking: true,
            motivationalSupport: true
          }
        });
    } catch (error: any) {
      logger.error("Error getting chatbot features:", error);
      sendError(res, "Failed to retrieve chatbot features.", 500);
    }
  }
}

export default new ChatbotController();
