import Joi from "joi";
import { Goal } from "../types/model/goal.model";
import { UserProfile } from "../types/model/userProfile.model";
import { FitnessLevel, Gender, Objective } from "../common/common-enum";

export const userProfileSchema = Joi.object<UserProfile>({
  userId: Joi.number().integer().positive().required(),
  age: Joi.number().integer().min(13).max(100).required(),
  gender: Joi.string().valid(Gender.MALE, Gender.FEMALE).required(),
  height: Joi.number().min(100).max(250).required(),
  weight: Joi.number().min(30).max(300).required(),
  fitnessLevel: Joi.string()
    .valid(
      FitnessLevel.BEGINNER,
      FitnessLevel.INTERMEDIATE,
      FitnessLevel.ADVANCED
    )
    .required(),
  availableEquipment: Joi.array().items(Joi.string()).required(),
  injuries: Joi.array().items(Joi.string()).optional(),
});

export const goalSchema = Joi.object<Goal>({
  id: Joi.number().integer().positive().required(),
  userProfile: userProfileSchema.required(),
  objective: Joi.string()
    .valid(
      Objective.LOSE_FAT,
      Objective.GAIN_MUSCLE,
      Objective.ENDURANCE,
      Objective.MAINTAIN
    )
    .required(),
  sessionsPerWeek: Joi.number().integer().min(1).max(7).required(),
  sessionMinutes: Joi.number().integer().min(10).max(120).required(),
});

// export const workoutPlanRequestSchema = Joi.object<WorkoutPlanRequest>({
//   userProfile: userProfileSchema.required(),
//   goalDescription: Joi.string().min(10).max(500).required(),
//   focusAreas: Joi.array().items(Joi.string()).optional(),
//   durationWeeks: Joi.number().integer().min(1).max(52).optional(),
//   intensityPreference: Joi.string().valid("LOW", "MODERATE", "HIGH").optional(),
//   timeConstraints: Joi.string().max(200).optional(),
//   specificRequirements: Joi.string().max(500).optional(),
// });

// export const nutritionPlanRequestSchema = Joi.object<NutritionPlanRequest>({
//   userProfile: userProfileSchema.required(),
//   goalDescription: Joi.string().min(10).max(500).required(),
//   targetCalories: Joi.number().integer().min(1000).max(5000).optional(),
//   dietaryRestrictions: Joi.array().items(Joi.string()).optional(),
//   foodAllergies: Joi.array().items(Joi.string()).optional(),
//   mealsPerDay: Joi.number().integer().min(3).max(8).optional(),
//   durationWeeks: Joi.number().integer().min(1).max(52).optional(),
//   budgetConstraints: Joi.string().valid("LOW", "MODERATE", "HIGH").optional(),
//   cookingSkillLevel: Joi.string()
//     .valid("BEGINNER", "INTERMEDIATE", "ADVANCED")
//     .optional(),
//   mealPrepPreference: Joi.boolean().optional(),
// });
