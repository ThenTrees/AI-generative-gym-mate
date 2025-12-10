import express from "express";
import mealPlanController from "../../controllers/mealPlan.controller";
import { validateRequest } from "../../middlewares/schema-validation.middleware";
import {
  addFoodToMealPlanSchema,
  generateMealPlanSchema,
  mealPlanDayParamsSchema,
  mealPlanItemStatusSchema,
} from "../../validators/meal-plan.validator";

const router = express.Router();

// router.post("/search", mealPlanController.generateMealPlanForUser);
router.get(
  "/meal-plan/:userId",
  validateRequest(mealPlanDayParamsSchema),
  mealPlanController.getMealPlanDay
);
router.post(
  "/meal-plan/generate",
  validateRequest(generateMealPlanSchema),
  mealPlanController.generateMealPlanForUser
);
// eated
router.patch(
  "/meal-plan-item/completed",
  validateRequest(mealPlanItemStatusSchema),
  mealPlanController.mealPlanItemCompleted
);

// add food to meal plan
router.patch(
  "/meal-plan-item/add-to-plan",
  validateRequest(addFoodToMealPlanSchema),
  mealPlanController.addToMealPlan
);

export default router;
