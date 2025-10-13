import { Pool, types } from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { DATABASE_CONFIG } from "../configs/database";
import { logger } from "../utils/logger";
import { config } from "../configs/environment";
import { FoodLoader } from "../loaders/foodLoader";
import { Food } from "../types/model/food";
import { NutritionTarget } from "../types/model/nutritionTarget";
import { PgVectorService } from "./pgVector.service";

export interface FoodEmbeddingDocument {
  id: string;
  foodId: string;
  content: string;
  metadata: any;
  similarity: number;
}
types.setTypeParser(1082, (val) => val);
export class FoodVectorService {
  private pool: Pool;
  private genai: GoogleGenerativeAI;
  private foodLoader: FoodLoader;
  private pgVectorService: PgVectorService;

  private static readonly EMBEDDING_DIM = 1536; // Gemini embedding dimension we normalize to

  constructor() {
    this.pool = new Pool({
      ...DATABASE_CONFIG,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    this.genai = new GoogleGenerativeAI(config.gemini.apiKey!);
    this.foodLoader = new FoodLoader();
    this.pgVectorService = new PgVectorService();
  }

  async initialize(): Promise<void> {
    logger.info("Initializing Food Vector Service...");
    await this.checkTablesExist();

    const stats = await this.getEmbeddingStats();
    if (stats.total === 0) {
      logger.info(
        "No food embeddings found, loading foods and creating embeddings..."
      );
      await this.loadAndStoreFoods();
    } else {
      logger.info(`Found ${stats.total} existing food embeddings`);
    }
  }

  private async checkTablesExist(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'food_embeddings'
        );
      `);
      if (!result.rows[0].exists) {
        throw new Error(
          "food_embeddings table not found. Please add a migration to create it (similar to exercise_embeddings)."
        );
      }
    } finally {
      client.release();
    }
  }

  async loadAndStoreFoods(): Promise<void> {
    const foods = await this.foodLoader.loadFoods();
    if (foods.length === 0) {
      logger.info("No foods to process");
      return;
    }

    const client = await this.pool.connect();
    try {
      const batchSize = 50;
      for (let i = 0; i < foods.length; i += batchSize) {
        const batch = foods.slice(i, i + batchSize);
        await this.processBatch(client, batch);
        logger.info(
          `Processed food batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
            foods.length / batchSize
          )}`
        );
      }
      await client.query("ANALYZE food_embeddings");
    } finally {
      client.release();
    }
  }

  private async processBatch(client: any, foods: Food[]): Promise<void> {
    for (const food of foods) {
      try {
        const content = this.foodLoader.createFoodContent(food);
        const embedding = await this.pgVectorService.embed(content);

        const metadata = {
          foodName: food.foodName,
          foodNameVi: food.foodNameVi,
          category: food.category,
          mealTime: food.mealTime,
          calories: food.calories,
          protein: food.protein,
          carbs: food.carbs,
          fat: food.fat,
          tags: food.tags || [],
        };

        const embeddingLiteral = `[${embedding.join(",")}]`;

        const updateRes = await client.query(
          `
          UPDATE food_embeddings
          SET content = $2,
              embedding = $3::vector,
              metadata = $4::jsonb,
              updated_at = NOW()
          WHERE food_id = $1
        `,
          [food.id, content, embeddingLiteral, JSON.stringify(metadata)]
        );

        if (updateRes.rowCount === 0) {
          await client.query(
            `
            INSERT INTO food_embeddings (food_id, content, embedding, metadata)
            VALUES ($1, $2, $3::vector, $4::jsonb)
          `,
            [food.id, content, embeddingLiteral, JSON.stringify(metadata)]
          );
        }
      } catch (error) {
        logger.error(`Failed to process food ${food.foodName}: ${error}`);
      }
    }
  }

  // async similaritySearch(
  //   query: string,
  //   k: number = 20,
  //   threshold: number = 0.25
  // ): Promise<FoodEmbeddingDocument[]> {
  //   logger.info(`Searching similar foods: "${query}" (k=${k})`);
  //   const queryEmbedding = await this.embed(query);
  //   const client = await this.pool.connect();
  //   try {
  //     const result = await client.query(
  //       `
  //       SELECT
  //         fe.id,
  //         fe.food_id,
  //         fe.content,
  //         fe.metadata,
  //         1 - (fe.embedding <=> $1::vector) AS similarity
  //       FROM food_embeddings fe
  //       WHERE 1 - (fe.embedding <=> $1::vector) > $3
  //       ORDER BY fe.embedding <=> $1::vector
  //       LIMIT $2
  //     `,
  //       [`[${queryEmbedding.join(",")}]`, k, threshold]
  //     );

  //     return result.rows.map((row: any) => ({
  //       id: row.id,
  //       foodId: row.food_id,
  //       content: row.content,
  //       metadata: row.metadata,
  //       similarity: parseFloat(row.similarity),
  //     }));
  //   } finally {
  //     client.release();
  //   }
  // }

  /**
   * Vector similarity search
   */
  /**

   * Vector similarity search

   */

  async searchFoodsByVector(
    queryEmbedding: number[],

    filters: {
      category?: string;

      mealTime?: string;

      minProtein?: number;

      maxCalories?: number;
    } = {},

    limit: number = 20
  ): Promise<any[]> {
    let whereClause = "WHERE f.is_active = true AND f.is_deleted = false";

    const params: any[] = [JSON.stringify(queryEmbedding)];

    let paramIndex = 2;

    if (filters.category) {
      whereClause += ` AND f.category = $${paramIndex}`;

      params.push(filters.category);

      paramIndex++;
    }

    if (filters.mealTime) {
      whereClause += ` AND f.meal_time LIKE $${paramIndex}`;

      params.push(`%${filters.mealTime}%`);

      paramIndex++;
    }

    if (filters.minProtein) {
      whereClause += ` AND f.protein >= $${paramIndex}`;

      params.push(filters.minProtein);

      paramIndex++;
    }

    if (filters.maxCalories) {
      whereClause += ` AND f.calories <= $${paramIndex}`;

      params.push(filters.maxCalories);

      paramIndex++;
    }

    params.push(limit);

    const query = `
          SELECT
            f.id as "foodId",
            f.food_name as "foodName",
            f.food_name_vi as "foodNameVi",
            f.calories, f.protein, f.carbs, f.fat, f.fiber,
            f.category, f.meal_time as "mealTime",
            f.description, f.detailed_benefits as "detailedBenefits",
            f.preparation_tips as "preparationTips",
            f.common_combinations as "commonCombinations",
            f.image_url as "imageUrl",
            1 - (fe.embedding <=> $1::vector) AS similarity
            FROM food_embeddings fe
            JOIN foods f ON f.id = fe.food_id
            ${whereClause}
            ORDER BY fe.embedding <=> $1::vector
            LIMIT $${paramIndex}
          `;
    const result = await this.pool.query(query, params);
    return result.rows;
  }

  async getFoodsByIds(foodIds: string[]): Promise<Food[]> {
    if (foodIds.length === 0) return [];
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
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
          f.common_combinations,
          f.contraindications,
          f.tags,
          f.image_url
        FROM foods f
        WHERE f.id = ANY($1::uuid[]) AND f.is_deleted = false
      `,
        [foodIds]
      );

      return result.rows.map((row: any) => ({
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
      }));
    } finally {
      client.release();
    }
  }

  async refreshEmbeddings(): Promise<void> {
    await this.loadAndStoreFoods();
  }

  async getEmbeddingStats(): Promise<{ total: number; lastUpdated: string }> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT COUNT(*) as total, MAX(updated_at) as last_updated FROM food_embeddings
      `);
      return {
        total: parseInt(result.rows[0].total),
        lastUpdated: result.rows[0].last_updated,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Save or update nutrition target
   */
  async saveNutritionTarget(
    pool: Pool,
    target: NutritionTarget
  ): Promise<string> {
    // Deactivate old targets
    await pool.query(
      `
      UPDATE nutrition_targets 
      SET is_active = false 
      WHERE user_id = $1 AND is_active = true
    `,
      [target.userId]
    );

    // Insert new target
    const query = `
      INSERT INTO nutrition_targets (
        user_id, goal_id, calories_kcal, protein_g, fat_g, carbs_g,
        bmr, tdee, activity_level, goal_type, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `;

    const values = [
      target.userId,
      target.goalId,
      target.caloriesKcal,
      target.proteinG,
      target.fatG,
      target.carbsG,
      target.bmr,
      target.tdee,
      target.activityLevel,
      target.goalType,
      true,
    ];

    const result = await pool.query(query, values);
    return result.rows[0].id;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const foodVectorService = new FoodVectorService();
