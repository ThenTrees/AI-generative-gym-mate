export interface Food {
  id?: string;
  foodName: string;
  foodNameVi?: string;
  description?: string;
  servingWeightGrams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  vitaminA?: number;
  vitaminC?: number;
  vitaminD?: number;
  category: string;
  mealTime?: string;
  imageUrl?: string;
  detailedBenefits?: string;
  commonCombinations?: string;
  contraindications?: string;
  tags?: string[];
}
