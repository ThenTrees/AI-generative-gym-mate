import express from "express";
const router = express.Router();

import healthRoute from "./health";
import generationRoute from "./gym-plan";
import mealPlanRoute from "./meal-plan";
import locationRoute from "./location";
import chatbotRoute from "./chatbot";

// Main health endpoint for mobile app
router.use("/health", healthRoute);
router.use("/api/health", healthRoute);

// AI endpoints
router.use("/api/v1/ai", generationRoute);
router.use("/api/v1/ai/nutrition", mealPlanRoute);

// Location and Chatbot endpoints
router.use("/api/location", locationRoute);
router.use("/api/chatbot", chatbotRoute);

export default router;
