import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import { sendError, sendSuccess } from "../utils/response";
import { PlanRequest } from "../types/request/planRequest";
import WorkoutPlanGeneratorService from "../services/workoutPlanGenerator.service";

class GymPlanController {
  constructor() {
    this.generateWorkoutPlan = this.generateWorkoutPlan.bind(this);
    this.getWorkoutPlan = this.getWorkoutPlan.bind(this);
  }

  generateWorkoutPlan = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    try {
      const planRequest: PlanRequest = req.body;

      logger.info(
        `[Controller] - Generating workout plan for user ${planRequest.userId}`
      );
      const startTime = Date.now();
      const workoutPlan = await WorkoutPlanGeneratorService.generateWorkoutPlan(
        planRequest
      );
      const generationTime = Date.now() - startTime;

      const totalExercises = workoutPlan.planDays.reduce(
        (sum, day) => sum + day.planItems.length,
        0
      );
      const avgSessionDuration = Math.round(
        workoutPlan.planDays.reduce((sum, day) => sum + day.totalDuration, 0) /
          workoutPlan.planDays.length /
          60
      );

      sendSuccess(
        res,
        `Successfully generated ${workoutPlan.planDays.length}-day workout plan`,
        {
          workoutPlan,
          startTime,
          generationTime,
          totalExercises,
          avgSessionDuration,
        },
        201
      );
    } catch (error) {
      logger.error("Workout plan generation error:", error);

      sendError(
        res,
        "Failed to generate workout plan",
        500,
        error instanceof Error ? error.message : "Unknown error occurred"
      );
    }
  };

  // Add other methods as needed
  getWorkoutPlan = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Your logic here
      sendSuccess(res, "Workout plan retrieved successfully", {});
    } catch (error) {
      next(error);
    }
  };
}

// Export class instance (Singleton)
export default new GymPlanController();
