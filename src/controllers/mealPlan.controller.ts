import { mealPlanGenerator } from "./../services/mealPlanGenerator.service";
import { NextFunction, Request, Response } from "express";
import { logger } from "../utils/logger";
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
      const { mealPlanItemId, MealPlanId, mealTimeId, foodId, completed } =
        req.body;
    } catch (error) {}
  };

  searchFoodByNaturalLanguage = async (req: Request, res: Response) => {};
}

// Export class instance (Singleton)
export default new MealPlanController();
