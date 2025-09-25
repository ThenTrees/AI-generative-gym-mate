import SuccessResponse from "../types/response/success.response";
import { Request, Response, NextFunction } from "express";

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

      new SuccessResponse({
        message: "Workout plan generated successfully",
        statusCode: 201,
        metadata: {
          planId: "123",
          exercises: [],
        },
      }).send(res);
    } catch (error) {
      next(error);
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
