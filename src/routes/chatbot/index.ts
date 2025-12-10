import express from "express";
import chatbotController from "../../controllers/chatbot.controller";
import { validateRequest } from "../../middlewares/schema-validation.middleware";
import {
  chatBodySchema,
  conversationParamsSchema,
} from "../../validators/chatbot.validator";

const router = express.Router();

/**
 * @route POST /api/chatbot/chat
 * @desc Send a message to the AI chatbot
 * @access Public
 */
router.post(
  "/chat",
  validateRequest({ body: chatBodySchema }),
  (req, res) => chatbotController.chat(req, res)
);

/**
 * @route POST /api/chatbot/workout-suggestion
 * @desc Get specific workout suggestions based on user message
 * @access Public
 */
router.post(
  "/workout-suggestion",
  validateRequest({ body: chatBodySchema }),
  (req, res) => chatbotController.workoutSuggestion(req, res)
);

/**
 * @route POST /api/chatbot/nutrition-advice
 * @desc Get specific nutrition advice based on user message
 * @access Public
 */
router.post(
  "/nutrition-advice",
  validateRequest({ body: chatBodySchema }),
  (req, res) => chatbotController.nutritionAdvice(req, res)
);

/**
 * @route GET /api/chatbot/conversation/:conversationId
 * @desc Get conversation history
 * @access Public
 */
router.get(
  "/conversation/:conversationId",
  validateRequest({ params: conversationParamsSchema }),
  (req, res) => chatbotController.getConversation(req, res)
);

/**
 * @route DELETE /api/chatbot/conversation/:conversationId
 * @desc Clear conversation history
 * @access Public
 */
router.delete(
  "/conversation/:conversationId",
  validateRequest({ params: conversationParamsSchema }),
  (req, res) => chatbotController.clearConversation(req, res)
);

/**
 * @route GET /api/chatbot/features
 * @desc Get available chatbot features and capabilities
 * @access Public
 */
router.get("/features", (req, res) => chatbotController.getFeatures(req, res));

export default router;
