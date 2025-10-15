export interface NutritionTarget {
  id?: string;
  userId: string;
  goalId?: string;
  caloriesKcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  bmr?: number;
  tdee?: number;
  activityLevel?: string;
  goalType?: string;
  isActive: boolean;
}
