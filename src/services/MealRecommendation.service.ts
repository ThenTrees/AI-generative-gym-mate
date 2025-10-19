import { Objective } from "../common/common-enum";
import { FoodVectorService } from "./foodVector.service";
import { PgVectorService } from "./pgVector.service";
import {
  NUTRITION_CONSTANTS,
  NUTRITION_THRESHOLDS,
} from "../utils/nutritionConstants";
import { MealTime } from "../types/model/mealTime";
import { Food } from "../types/model/food";
import { FoodRecommendation } from "../types/model/foodRecommendation";
import { Pool } from "pg";
import { DATABASE_CONFIG } from "../configs/database";
import { logger } from "../utils/logger";
export interface MealContext {
  mealTime: MealTime;
  targetCalories: number;
  targetProtein: number;
  targetCarbs: number;
  targetFat?: number;
  objective: Objective;
  isTrainingDay: boolean;
  userWeight?: number;
  userHeight?: number;
  userGender?: string;
}

/**
 * Service responsible for meal recommendations and food scoring
 */
export class MealRecommendationService {
  private foodVectorService: FoodVectorService;
  private pgVectorService: PgVectorService;
  private pool: Pool;
  constructor() {
    this.pool = new Pool({
      ...DATABASE_CONFIG,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    this.foodVectorService = new FoodVectorService();
    this.pgVectorService = new PgVectorService();
  }

  /**
   * Generate meal recommendations for a specific meal time
   */
  async generateMealRecommendations(
    context: MealContext,
    userId: string
  ): Promise<FoodRecommendation[]> {
    const excludedIds = await this.getFoodIdNear2Day(userId);
    // Build search query
    const query = await this.buildMealQuery(context);

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
      excludedIds,
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

  private async getFoodIdNear2Day(userId: string) {
    const client = await this.pool.connect();
    try {
      const recentFoods = await client.query(
        `
          SELECT mpi.food_id
          FROM meal_plan_items mpi
          JOIN meal_plans mp ON mpi.meal_plan_id = mp.id
          WHERE mp.user_id = $1 AND mp.plan_date >= CURRENT_DATE - INTERVAL '2 days' AND mpi.is_completed = true;
        `,
        [userId]
      );
      return recentFoods.rows.map((f) => f.food_id);
    } catch (error) {
      logger.error("get food failed!");
      return [];
    } finally {
      client.release();
    }
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
    const dishesPerMeal = NUTRITION_CONSTANTS.DEFAULT_DISHES_PER_MEAL || 4;
    const perDishCalories = targetCalories / dishesPerMeal;

    // Tính tỷ lệ dựa trên per-dish calories thay vì toàn bữa
    const ratio = perDishCalories / (food.calories || 100);

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
  private async buildMealQuery(context: MealContext): Promise<string> {
    const {
      mealTime,
      targetCalories,
      targetProtein,
      targetCarbs,
      targetFat,
      objective,
      isTrainingDay,
      userWeight,
      userHeight,
      userGender,
    } = context;
    // Base query
    let query = `Bạn là chuyên gia dinh dưỡng về Gym. Hãy gợi ý cho tôi những món ăn vào buổi ${mealTime.nameVi}. với ${targetCalories} calories, bao gồm ${targetProtein} protein và ${targetCarbs} carbs `;

    if (targetFat) query += ` và ${targetFat}g chất béo.`;
    else query += ".";

    if (userWeight || userHeight || userGender) {
      query += ` Tôi  `;
      if (userGender)
        query += `${
          userGender.toLocaleLowerCase() === "male" ? "là nam" : "là nữ"
        }`;
      if (userWeight) query += `, nặng ${userWeight}kg`;
      if (userHeight) query += `, cao ${userHeight}cm`;
      query += `. `;
    }

    // Add objective-specific requirements
    const objectiveMap = {
      [Objective.GAIN_MUSCLE]:
        "Mục tiêu là tăng cơ nạc, ưu tiên thực phẩm giàu protein, carb chất lượng và ít chất béo xấu. ",
      [Objective.LOSE_FAT]:
        "Mục tiêu là giảm mỡ, nên ưu tiên món ít calo, nhiều chất xơ và ít đường, dầu mỡ. ",
      [Objective.ENDURANCE]:
        "Mục tiêu là tăng sức bền, cần cân đối giữa carb phức và protein vừa phải. ",
      [Objective.MAINTAIN]:
        "Mục tiêu là duy trì cân nặng hiện tại với tỷ lệ dinh dưỡng cân đối. ",
    };

    if (objectiveMap[objective]) {
      query += objectiveMap[objective];
    }

    // Add workout context
    if (isTrainingDay) {
      query += "Hôm nay là ngày tập luyện. ";
    } else {
      query +=
        "Hôm nay là ngày nghỉ, nên giảm lượng carb và calo nhẹ so với ngày tập. ";
    }

    // Add general preferences
    query += "Ưu tiên các phương pháp chế biến lành mạnh như luộc, hấp, nướng.";

    return query;
  }
}
