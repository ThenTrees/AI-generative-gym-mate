import { Gender, Objective } from "../common/common-enum";
import { NUTRITION_CONSTANTS } from "../utils/nutritionConstants";

export interface UserProfile {
  gender: Gender;
  weightKg: number;
  heightCm: number;
  age: number;
}

export interface Goal {
  id: string;
  objective: Objective;
  sessionsPerWeek: number;
}

export interface NutritionTarget {
  bmr: number;
  tdee: number;
  targetCalories: number;
  macros: {
    proteinG: number;
    carbsG: number;
    fatG: number;
  };
}

export interface MealNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * Service responsible for all nutrition calculations
 */
export class NutritionCalculationService {
  /**
   * Calculate BMR using Mifflin-St Jeor equation
   */
  calculateBMR(profile: UserProfile): number {
    const { gender, weightKg, heightCm, age } = profile;

    if (gender === Gender.MALE) {
      return 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
    } else {
      return 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
    }
  }

  /**
   * Calculate TDEE based on activity level
   */
  calculateTDEE(bmr: number, sessionsPerWeek: number): number {
    let multiplier: number;

    if (sessionsPerWeek <= 3) {
      multiplier = NUTRITION_CONSTANTS.TDEE_MULTIPLIERS.LOW;
    } else if (sessionsPerWeek <= 5) {
      multiplier = NUTRITION_CONSTANTS.TDEE_MULTIPLIERS.MODERATE;
    } else {
      multiplier = NUTRITION_CONSTANTS.TDEE_MULTIPLIERS.HIGH;
    }

    return bmr * multiplier;
  }

  /**
   * Calculate target calories based on goal and training status
   */
  calculateTargetCalories(
    tdee: number,
    objective: Objective,
    isTrainingDay: boolean,
    workoutCalories: number = 0
  ): number {
    const adjustments = NUTRITION_CONSTANTS.CALORIE_ADJUSTMENTS[objective];

    if (isTrainingDay) {
      const adjustment = adjustments.trainingDay;
      if (typeof adjustment === "number") {
        return tdee + workoutCalories + adjustment;
      } else {
        return tdee + workoutCalories * adjustment;
      }
    } else {
      const adjustment = adjustments.restDay;
      return tdee + adjustment;
    }
  }

  /**
   * Calculate macronutrient distribution
   */
  calculateMacros(calories: number, objective: Objective) {
    const ratios = NUTRITION_CONSTANTS.MACRO_RATIOS[objective];

    return {
      proteinG: Math.round((calories * ratios.protein) / 4),
      carbsG: Math.round((calories * ratios.carbs) / 4),
      fatG: Math.round((calories * ratios.fat) / 9),
    };
  }

  /**
   * Calculate complete nutrition target
   */
  calculateNutritionTarget(
    profile: UserProfile,
    goal: Goal,
    isTrainingDay: boolean,
    workoutCalories: number = 0
  ): NutritionTarget {
    const bmr = Math.round(this.calculateBMR(profile));
    const tdee = Math.round(this.calculateTDEE(bmr, goal.sessionsPerWeek));
    const targetCalories = this.calculateTargetCalories(
      tdee,
      goal.objective,
      isTrainingDay,
      workoutCalories
    );
    const macros = this.calculateMacros(targetCalories, goal.objective);

    return {
      bmr,
      tdee,
      targetCalories,
      macros,
    };
  }

  /**
   * Calculate nutrition for a specific meal time
   */
  calculateMealNutrition(
    targetNutrition: NutritionTarget,
    caloriePercentage: number
  ): MealNutrition {
    const percentage = caloriePercentage / 100;

    return {
      calories: Math.round(targetNutrition.targetCalories * percentage),
      protein: Math.round(targetNutrition.macros.proteinG * percentage),
      carbs: Math.round(targetNutrition.macros.carbsG * percentage),
      fat: Math.round(targetNutrition.macros.fatG * percentage),
    };
  }
}
