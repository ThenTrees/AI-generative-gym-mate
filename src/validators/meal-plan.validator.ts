import { z } from "zod";

export const generateMealPlanSchema = {
  body: z.object({
    userId: z.string().min(1, "userId is required"),
    date: z.union([z.string(), z.date()]).optional(),
  }),
};

export const mealPlanItemStatusSchema = {
  body: z.object({
    mealPlanItemId: z.string().min(1, "mealPlanItemId is required"),
    completed: z.boolean(),
  }),
};

export const addFoodToMealPlanSchema = {
  body: z.object({
    mealPlanId: z.string().min(1, "mealPlanId is required"),
    mealTimeId: z.string().min(1, "mealTimeId is required"),
    foodId: z.string().min(1, "foodId is required"),
    servings: z.number().positive("servings must be positive"),
  }),
};

export const mealPlanDayParamsSchema = {
  params: z.object({
    userId: z.string().min(1, "userId is required"),
    date: z.string().optional(),
  }),
};

