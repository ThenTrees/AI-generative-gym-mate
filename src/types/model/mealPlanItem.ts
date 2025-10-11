export interface MealPlanItem {
  id?: string;
  mealPlanId: string;
  mealTimeId: string;
  foodId?: string;
  foodName: string;
  servings: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  isCompleted: boolean;
  displayOrder: number;
}
