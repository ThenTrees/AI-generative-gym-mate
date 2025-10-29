"use strict";
import express from "express";
const healthRouter = express.Router();

healthRouter.get("/", (req, res) => {
  res.json({
    success: true,
    message: 'GymMate AI Backend is healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

healthRouter.get("/status", (req, res) => {
  const healthCheck = {
    success: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      ai_api: process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY ? 'configured' : 'not_configured',
      gemini: process.env.GEMINI_API_KEY ? 'configured' : 'not_configured',
      openai: process.env.OPENAI_API_KEY ? 'configured' : 'not_configured',
      geoapify: process.env.GEOAPIFY_API_KEY ? 'configured' : 'not_configured',
      chatbot: 'active',
      location: 'active',
      workout_planner: 'active',
      nutrition_planner: 'active'
    },
    endpoints: {
      chatbot: '/api/chatbot',
      location: '/api/location',
      workout: '/api/v1/ai',
      nutrition: '/api/v1/ai/nutrition'
    }
  };
  
  res.json(healthCheck);
});

export default healthRouter;
