export interface MealPlan {
  id?: string;
  userId: string;
  planDate: Date;
  totalCalories?: number;
  totalProtein?: number;
  totalCarbs?: number;
  totalFat?: number;
  isTrainingDay: boolean;
  baseCalories?: number;
  workoutAdjustment?: number;
  aiReasoning?: string;
  aiTips?: any[];
  status?: string;
}
