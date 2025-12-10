import { NextFunction, Request, Response } from "express";
import { mealPlanGenerator } from "../services/mealPlanGenerator.service";
import { logger } from "../utils/logger";
import { sendError, sendSuccess } from "../utils/response";
class MealPlanController {
  constructor() {}

  generateMealPlanForUser = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { userId, date } = req.body;

      const mealPlan = await mealPlanGenerator.generateDayMealPlan(
        userId,
        new Date(date || Date.now())
      );

      sendSuccess(res, "Meal plan generated", mealPlan);
    } catch (error: any) {
      logger.error("generation meal plan error:", error);

      sendError(res, "Failed to generate meal plan", 500, error.message);
    }
  };

  mealPlanItemCompleted = async (req: Request, res: Response) => {
    try {
      const { mealPlanItemId, completed } = req.body;

      await mealPlanGenerator.updateMealPlanItemStatus(
        mealPlanItemId,
        completed
      );
      sendSuccess(res, "Meal plan item updated");
    } catch (error: any) {
      logger.error("meal plan item completed error:", error);

      sendError(res, "Failed to update meal plan item", 500, error.message);
    }
  };

  addToMealPlan = async (req: Request, res: Response) => {
    try {
      const { mealPlanId, mealTimeId, foodId, servings } = req.body;
      await mealPlanGenerator.addFoodIntoMealPlan(
        mealPlanId,
        mealTimeId,
        foodId,
        servings
      );
      sendSuccess(res, "Added food to meal plan successfully!");
    } catch (error: any) {
      logger.error("add food to meal plan error:", error);

      sendError(res, "Failed to add food to meal plan", 500, error.message);
    }
  };

  getMealPlanDay = async (req: Request, res: Response) => {
    try {
      const { userId, date } = req.params;
      const mealPlan = await mealPlanGenerator.getMealPlanUserId(
        userId,
        new Date(date || Date.now())
      );
      sendSuccess(res, "Meal plan retrieved", mealPlan);
    } catch (error: any) {
      logger.error("get meal plan date error:", error);

      sendError(res, "Failed to retrieve meal plan", 500, error.message);
    }
  };
}

// Export class instance (Singleton)
export default new MealPlanController();
