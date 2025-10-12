"use strict";
import express from "express";
import mealPlanController from "../../controllers/mealPlan.controller";

const router = express.Router();

// router.post("/search", mealPlanController.generateMealPlanForUser);
router.post("/meal-plan/generate", mealPlanController.generateMealPlanForUser);
router.get("/meal-plan-item/completed");

export default router;
