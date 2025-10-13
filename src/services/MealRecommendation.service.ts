import { Objective } from "../common/common-enum";
import { FoodVectorService } from "./FoodVector.service";
import { PgVectorService } from "./pgVector.service";
import {
  NUTRITION_CONSTANTS,
  NUTRITION_THRESHOLDS,
} from "../utils/nutritionConstants";
import { MealTime } from "../types/model/mealTime";
import { Food } from "../types/model/food";
import { FoodRecommendation } from "../types/model/foodRecommendation";

export interface MealContext {
  mealTime: MealTime;
  targetCalories: number;
  targetProtein: number;
  targetCarbs: number;
  objective: Objective;
  isTrainingDay: boolean;
}

/**
 * Service responsible for meal recommendations and food scoring
 */
export class MealRecommendationService {
  private foodVectorService: FoodVectorService;
  private pgVectorService: PgVectorService;

  constructor() {
    this.foodVectorService = new FoodVectorService();
    this.pgVectorService = new PgVectorService();
  }

  /**
   * Generate meal recommendations for a specific meal time
   */
  async generateMealRecommendations(
    context: MealContext
  ): Promise<FoodRecommendation[]> {
    // Build search query
    const query = this.buildMealQuery(context);

    // Generate query embedding
    const queryEmbedding = await this.pgVectorService.embed(query);

    const maxCalories =
      context.targetCalories * NUTRITION_CONSTANTS.MAX_CALORIE_RATIO;

    // Search for food candidates
    const candidates = await this.foodVectorService.searchFoodsByVector(
      queryEmbedding,
      {
        mealTime: context.mealTime.code,
        maxCalories: maxCalories,
      },
      NUTRITION_CONSTANTS.DEFAULT_SEARCH_LIMIT
    );

    // Score and rank candidates
    const recommendations = candidates.map((food: Food) => {
      const score = this.calculateFoodScore(food, context);
      const servingSuggestion = this.calculateServingSuggestion(
        food,
        context.targetCalories
      );

      return {
        ...food,
        score,
        reason: `Phù hợp cho ${context.mealTime.nameVi}`,
        servingSuggestion,
        targetCalories: maxCalories,
      };
    });

    return recommendations
      .sort((a, b) => b.score - a.score)
      .slice(0, NUTRITION_CONSTANTS.MAX_RECOMMENDATIONS);
  }

  /**
   * Calculate comprehensive food score
   */
  private calculateFoodScore(food: any, context: MealContext): number {
    const similarityScore =
      (food.similarity || 0) * NUTRITION_CONSTANTS.SIMILARITY_WEIGHT;
    const nutritionBonus = this.calculateNutritionBonus(food, context);
    const goalBonus = this.calculateGoalBonus(food, context.objective);

    return similarityScore + nutritionBonus + goalBonus;
  }

  /**
   * Calculate nutrition-based bonus score
   */
  private calculateNutritionBonus(food: Food, context: MealContext): number {
    let bonus = 0;

    // Protein bonus
    if (
      context.targetProtein > NUTRITION_THRESHOLDS.HIGH_PROTEIN &&
      food.protein > NUTRITION_THRESHOLDS.PROTEIN_BONUS_THRESHOLD
    ) {
      bonus += NUTRITION_CONSTANTS.PROTEIN_BONUS;
    }

    // Carbs bonus
    if (
      context.targetCarbs > NUTRITION_THRESHOLDS.HIGH_CARBS &&
      food.carbs > NUTRITION_THRESHOLDS.CARBS_BONUS_THRESHOLD
    ) {
      bonus += NUTRITION_CONSTANTS.CARBS_BONUS;
    }

    return bonus;
  }

  /**
   * Calculate goal-based bonus score
   */
  private calculateGoalBonus(food: Food, objective: Objective): number {
    const goalBonus = NUTRITION_CONSTANTS.GOAL_BONUS[objective];

    switch (objective) {
      case Objective.GAIN_MUSCLE:
        return food.protein > NUTRITION_THRESHOLDS.HIGH_PROTEIN
          ? goalBonus
          : NUTRITION_CONSTANTS.GOAL_BONUS_FALLBACK;

      case Objective.LOSE_FAT:
        return food.calories < NUTRITION_THRESHOLDS.LOW_CALORIES
          ? goalBonus
          : 5;

      case Objective.ENDURANCE:
        return food.carbs > NUTRITION_THRESHOLDS.HIGH_CARBS
          ? goalBonus
          : NUTRITION_CONSTANTS.GOAL_BONUS_FALLBACK;

      default:
        return 0;
    }
  }

  /**
   * Calculate suggested serving size
   */
  private calculateServingSuggestion(
    food: Food,
    targetCalories: number
  ): number {
    const ratio = targetCalories / (food.calories || 100);
    const grams = Math.min(
      NUTRITION_CONSTANTS.MAX_SERVING_GRAMS,
      Math.max(NUTRITION_CONSTANTS.MIN_SERVING_GRAMS, ratio * 100)
    );

    return (
      Math.round(grams / NUTRITION_CONSTANTS.SERVING_ROUND_TO) *
      NUTRITION_CONSTANTS.SERVING_ROUND_TO
    );
  }

  /**
   * Build meal query for vector search
   */
  private buildMealQuery(context: MealContext): string {
    const {
      mealTime,
      targetCalories,
      targetProtein,
      targetCarbs,
      objective,
      isTrainingDay,
    } = context;

    // Base query
    let query = `Bạn là chuyên gia dinh dưỡng về Gym. Hãy gợi ý cho tôi những món ăn vào buổi ${mealTime.nameVi}. với ${targetCalories} calories, bao gồm ${targetProtein} protein và ${targetCarbs} carbs. `;

    // Add objective-specific requirements
    const objectiveMap = {
      [Objective.GAIN_MUSCLE]:
        "Những món ăn này cần giúp tăng cơ nạc, giàu protein nhưng hạn chế chất béo không cần thiết. ",
      [Objective.LOSE_FAT]:
        "Những món ăn này cần hỗ trợ giảm mỡ, ít calo, ít đường và dầu mỡ. ",
      [Objective.ENDURANCE]:
        "Những món ăn này cần tối ưu cho sức bền, cung cấp nhiều carb phức. ",
      [Objective.MAINTAIN]: "Những món ăn này giúp duy trì cân nặng hiện tại. ", // TODO: đưa cân nặng vào
    };

    if (objectiveMap[objective]) {
      query += objectiveMap[objective];
    }

    // Add workout context
    if (isTrainingDay) {
      query += " Lưu ý rằng hôm nay có lịch tập. ";
    } else {
      query += "Lưu ý rằng hôm nay không có lịch tập. ";
    }

    // Add general preferences
    query += "Ưu tiên các phương pháp chế biến lành mạnh như luộc, hấp, nướng.";

    return query;
  }
}
