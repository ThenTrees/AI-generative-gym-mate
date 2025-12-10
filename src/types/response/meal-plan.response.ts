/**
 * Unified response for meal plan (both generate and get existing)
 */
export interface MealPlanResponse {
  mealPlanId: string;
  planDate: string;
  isTrainingDay: boolean;
  meals: {
    [mealTimeCode: string]: MealItemResponse[];
  };
  actualNutrition: NutritionSummary;
  targetNutrition: NutritionTarget;
}

export interface MealItemResponse {
  mealPlanItemId?: string; // Only present if saved to DB
  mealTimeId: string;
  servings: number;
  completed?: boolean; // Only present if retrieved from DB
  displayOrder?: number;
  nutrition: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  food: FoodInfo;
}

export interface FoodInfo {
  id: string;
  name: string;
  nameVi: string;
  description?: string;
  commonCombinations?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  category: string;
  image?: string;
  benefits?: string;
}

export interface NutritionSummary {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface NutritionTarget extends NutritionSummary {
  caloriesForBreakfast: number;
  caloriesForLunch: number;
  caloriesForDinner: number;
  isTrainingDay?: boolean;
}

