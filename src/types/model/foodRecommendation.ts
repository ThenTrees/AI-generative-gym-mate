import { Food } from "./food";

export interface FoodRecommendation extends Food {
  score: number;
  reason: string;
  servingSuggestion: number;
}
