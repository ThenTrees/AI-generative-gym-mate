import { mealPlanGenerator } from "./../services/mealPlanGenerator.service";
import { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger";
import SuccessResponse from "../types/response/success.response";
class MealPlanController {
  constructor() {}

  generateMealPlanForUser = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const { userId, date, sessionId } = req.body;

      const mealPlan = await mealPlanGenerator.generateDayMealPlan(
        userId,
        new Date(date || Date.now()),
        sessionId
      );

      res.json({
        success: true,
        data: mealPlan,
      });
    } catch (error: any) {
      logger.error("generation meal plan error:", error);

      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };

  mealPlanItemCompleted = async (req: Request, res: Response) => {
    try {
      const { mealPlanItemId, completed } = req.body;

      await mealPlanGenerator.updateMealPlanItemStatus(
        mealPlanItemId,
        completed
      );
      res.json({
        success: true,
      });
    } catch (error: any) {
      logger.error("meal plan item completed error:", error);

      res.status(500).json({
        success: false,
        error: error.message,
      });
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
      res.json({
        success: true,
        message: "add food to meal plan successfully!",
      });
    } catch (error: any) {
      logger.error("add food to meal plan error:", error);

      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  };
}

// Export class instance (Singleton)
export default new MealPlanController();
