import { PlanRequest } from "../types/request/planRequest";
import SuccessResponse from "../types/response/success.response";
import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import WorkoutPlanGeneratorService from "../services/WorkoutPlanGenerator.service";

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
      // Your business logic here
      const planRequest: PlanRequest = req.body;
      // Validate request
      // const validation = validatePlanRequest(planRequest);
      // if (!validation.isValid) {
      //   return res.status(400).json({
      //     success: false,
      //     error: "Invalid request parameters",
      //     details: validation.errors,
      //   });
      // }

      logger.info(`Generating workout plan for user ${planRequest.userId}`);
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
      // const avgSimilarityScore = workoutPlan.planDays
      //   .flatMap((day) => day.planItems)
      //   .filter((item) => item.similarityScore)
      //   .reduce(
      //     (sum, item, _, arr) => sum + item.similarityScore! / arr.length,
      //     0
      //   );

      new SuccessResponse({
        message: `Successfully generated ${workoutPlan.planDays.length}-day workout plan`,
        statusCode: 201,
        metadata: {
          workoutPlan: workoutPlan,
          startTime,
          generationTime,
          totalExercises,
          avgSessionDuration,
        },
      }).send(res);
    } catch (error) {
      logger.error("Workout plan generation error:", error);

      res.status(500).json({
        success: false,
        error: "Failed to generate workout plan",
        details:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  };

  // Add other methods as needed
  getWorkoutPlan = async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Your logic here
      new SuccessResponse({
        message: "Workout plan retrieved successfully",
        metadata: {
          /* your data */
        },
      }).send(res);
    } catch (error) {
      next(error);
    }
  };
}

// Export class instance (Singleton)
export default new GymPlanController();
