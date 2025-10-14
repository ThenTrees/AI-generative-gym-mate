"use strict";
import express from "express";
import mealPlanController from "../../controllers/mealPlan.controller";

const router = express.Router();

// router.post("/search", mealPlanController.generateMealPlanForUser);
router.get("/meal-plan/:userId", mealPlanController.getMealPlanDay);
router.post("/meal-plan/generate", mealPlanController.generateMealPlanForUser);
// eated
router.patch(
  "/meal-plan-item/completed",
  mealPlanController.mealPlanItemCompleted
);

// add food to meal plan
router.patch("/meal-plan-item/add-to-plan", mealPlanController.addToMealPlan);

export default router;
