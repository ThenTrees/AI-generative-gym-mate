import { Client } from "pg";
import { DATABASE_CONFIG } from "../configs/database";
import { Food } from "../types/model/food";

export class FoodLoader {
  private client: Client;

  constructor() {
    this.client = new Client(DATABASE_CONFIG);
  }

  async loadFoods(): Promise<Food[]> {
    await this.client.connect();

    try {
      // Use existing schema with proper JOINs
      const query = `
        SELECT 
          f.id,
          f.food_name,
          f.food_name_vi,
          f.serving_weight_grams,
          f.calories,
          f.protein,
          f.carbs,
          f.fat,
          f.fiber,
          f.vitamin_a,
          f.vitamin_c,
          f.vitamin_d,
          f.category,
          f.meal_time,
          f.description,
          f.detailed_benefits,
          f.preparation_tips,
          f.common_combinations,
          f.contraindications,
          f.tags,
          f.image_url
        FROM foods f
        WHERE f.is_deleted = false
        ORDER BY f.food_name
      `;

      const result = await this.client.query(query);
      const foods: Food[] = [];

      for (const row of result.rows) {
        const food: Food = {
          id: row.id,
          foodName: row.food_name,
          foodNameVi: row.food_name_vi,
          servingWeightGrams: row.serving_weight_grams,
          calories: row.calories,
          protein: row.protein,
          carbs: row.carbs,
          fat: row.fat,
          fiber: row.fiber,
          vitaminA: row.vitamin_a,
          vitaminC: row.vitamin_c,
          vitaminD: row.vitamin_d,
          category: row.category,
          mealTime: row.meal_time,
          description: row.description,
          detailedBenefits: row.detailed_benefits,
          commonCombinations: row.common_combinations,
          contraindications: row.contraindications,
          tags: row.tags,
          imageUrl: row.image_url,
        };

        foods.push(food);
      }

      console.log(`✅ Loaded ${foods.length} foods from database`);
      return foods;
    } finally {
      await this.client.end();
    }
  }

  public createFoodContent(food: Food): string {
    const parts = [
      `Tên: ${food.foodNameVi || food.foodName}`,
      `Loại: ${food.category}`,
      `Dinh dưỡng: ${food.calories} calories, ${food.protein}g protein, ${food.carbs}g carbs, ${food.fat}g fat`,
      food.fiber && `Chất xơ: ${food.fiber}g`,
      food.description && `Mô tả: ${food.description}`,
      food.detailedBenefits && `Lợi ích: ${food.detailedBenefits}`,
      food.mealTime && `Bữa ăn: ${food.mealTime}`,
      food.tags && food.tags.length > 0 && `Tags: ${food.tags.join(", ")}`,
    ].filter(Boolean);

    return parts.join("\n");
  }
}
