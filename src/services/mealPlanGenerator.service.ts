import { userProfileSchema } from "./../utils/validators";
import { WorkoutCalculator } from "../utils/calculators";
import { FoodVectorService } from "./FoodVector.service";
import { PgVectorService } from "./pgVector.service";
import { Pool } from "pg";
import { MealTime } from "../types/model/mealTime";
import { DATABASE_CONFIG } from "../configs/database";
import { Objective } from "../common/common-enum";
import { MealPlan } from "../types/model/mealPlan";
import { FoodRecommendation } from "../types/model/foodRecommendation";
import { Food } from "../types/model/food";
import { NutritionTarget } from "../types/model/nutritionTarget";
import { convertDateFormat } from "../utils/convert";

export class MealPlanGenerator {
  private pool: Pool;
  private pgVectorService: PgVectorService;
  private foodVectorService: FoodVectorService;
  private workoutCalculator: WorkoutCalculator;
  constructor() {
    this.pool = new Pool({
      ...DATABASE_CONFIG,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    this.pgVectorService = new PgVectorService();
    this.foodVectorService = new FoodVectorService();
    this.workoutCalculator = new WorkoutCalculator();
  }
  /**
   * Get meal time distribution
   */
  async getMealTimes(): Promise<MealTime[]> {
    const result = await this.pool.query(`
      SELECT id, code, name, name_vi as "nameVi", 
             display_order as "displayOrder", icon,
             default_calorie_percentage as "defaultCaloriePercentage"
      FROM meal_times
      ORDER BY display_order
    `);

    return result.rows;
  }

  /**
   * Generate meal recommendations for specific meal time
   */
  private async generateMealRecommendations(
    mealTime: MealTime,
    targetCalories: number,
    targetProtein: number,
    targetCarbs: number,
    objective: Objective,
    isTrainingDay: boolean,
    workoutContext?: "pre-workout" | "post-workout"
  ): Promise<FoodRecommendation[]> {
    let query;
    if (isTrainingDay) {
      query = this.buildMealQuery(
        mealTime,
        objective,
        isTrainingDay,
        targetCalories,
        targetProtein,
        targetCarbs,
        workoutContext
      );
    } else {
      query = this.buildMealQuery(
        mealTime,
        objective,
        isTrainingDay,
        targetCalories,
        targetProtein,
        targetCarbs
      );
    }

    // Generate query embedding
    const queryEmbedding = await this.pgVectorService.embed(query);

    // Search
    const candidates = await this.foodVectorService.searchFoodsByVector(
      queryEmbedding,
      {
        mealTime: mealTime.code,
        maxCalories: targetCalories * 0.6, // * 0,6 de co the an them nhieu mon khac
      },
      30
    );

    // Nutrition bonuses
    const calcNutritionBonus = (food: Food): number => {
      let bonus = 0;
      if (targetProtein > 20 && food.protein > 15) bonus += 15;
      if (targetCarbs > 40 && food.carbs > 20) bonus += 10;
      return bonus;
    };

    const calcGoalBonus = (food: Food): number => {
      switch (objective) {
        case Objective.GAIN_MUSCLE:
          return food.protein > 20 ? 25 : 10;
        case Objective.LOSE_FAT:
          return food.calories < 150 ? 20 : 5;
        case Objective.ENDURANCE:
          return food.carbs > 30 ? 20 : 10;
        default:
          return 0;
      }
    };

    // Score and rank
    const recommendations: FoodRecommendation[] = candidates.map((food) => {
      let score = (food.similarity || 0) * 70; // old is 100
      const totalScore = score + calcGoalBonus(food) + calcNutritionBonus(food);
      // const servingSuggestion = Math.min(
      //   300,
      //   Math.max(50, (targetCalories / food.calories) * 100)
      // );

      const calcServingSuggestion = (food: Food): number => {
        const ratio = targetCalories / (food.calories || 100);
        const grams = Math.min(400, Math.max(50, ratio * 100));
        return Math.round(grams / 10) * 10;
      };

      const servingSuggestion = calcServingSuggestion(food);

      return {
        ...food,
        score: totalScore,
        reason: `Phù hợp cho ${mealTime.nameVi}`,
        servingSuggestion: Math.round(servingSuggestion / 10) * 10,
      };
    });

    return recommendations.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  /**
   * Generate complete meal plan
   */
  async generateDayMealPlan(
    userId: string,
    planDate: Date,
    sessionId?: string
  ): Promise<any> {
    // Get user profile
    const profile = await this.getProfile(userId);
    if (!profile) {
      throw new Error("User profile not found");
    }

    // Get active goal
    const goal = await this.getGoalByUser(userId);
    if (!goal) {
      throw new Error("No active goal found");
    }

    // Check if training day
    const isTrainingDay = !!sessionId; // if sessionId = null, undefined or "" return false <=> true
    let workoutCalories = 0;

    if (isTrainingDay && sessionId) {
      // Would calculate based on session data
      workoutCalories = 400; // Placeholder
    }
    let bmr;
    let tdee;
    let targetCalories;
    let macros;
    // check already nutrition target, if exist, skip step calc bmr, tdee and macro
    const nutritionTargetExist = await this.checkTargetNutritionAlready(
      userId,
      goal.id
    );

    if (nutritionTargetExist !== null) {
      bmr = nutritionTargetExist.bmr;
      tdee = nutritionTargetExist.tdee;
      targetCalories = nutritionTargetExist.calorieskcal;
      macros = {
        proteinG: nutritionTargetExist.proteing,
        carbsG: nutritionTargetExist.carbsg,
        fatG: nutritionTargetExist.fatg,
      };
    } else {
      bmr = Math.round(
        this.workoutCalculator.calculateBMR(
          profile.gender,
          profile.weightKg,
          profile.heightCm,
          profile.age
        )
      );
      tdee = Math.round(
        this.workoutCalculator.calculateTDEE(bmr, goal.sessionsPerWeek)
      );

      targetCalories = this.workoutCalculator.calculateTargetCalories(
        tdee,
        goal.objective,
        isTrainingDay,
        workoutCalories
      );

      macros = this.workoutCalculator.calculateMacros(
        targetCalories,
        goal.objective
      );
      this.saveNutritionTarget(
        userId,
        goal.id,
        targetCalories,
        macros.proteinG,
        macros.carbsG,
        macros.fatG,
        bmr,
        tdee,
        goal.objective
      );
    }

    console.log("\n🎯 Nutrition targets:");
    console.log(`  BMR: ${bmr} kcal`);
    console.log(`  TDEE: ${tdee} kcal`);
    console.log(`  Target: ${targetCalories} kcal`);
    console.log(`  Protein: ${macros.proteinG}g`);
    console.log(`  Carbs: ${macros.carbsG}g`);
    console.log(`  Fat: ${macros.fatG}g`);

    // Get meal times
    const mealTimes = await this.getMealTimes();

    console.log("\n🍽️  Generating meal plan...");

    const mealPlanExist = await this.getMealPlanByUserIdAndPlanDate(
      userId,
      convertDateFormat(planDate.toLocaleDateString())
    );

    const meals: any = {};
    // check meal plan already exist
    if (mealPlanExist) {
      return mealPlanExist;
    } else {
      /**
       * loop for mealtime, build base macro
       */
      for (const mealTime of mealTimes) {
        const mealCalories = Math.round(
          targetCalories * (mealTime.defaultCaloriePercentage / 100)
        );
        const mealProtein = Math.round(
          macros.proteinG * (mealTime.defaultCaloriePercentage / 100)
        );
        const mealCarbs = Math.round(
          macros.carbsG * (mealTime.defaultCaloriePercentage / 100)
        );

        meals[mealTime.code] = await this.generateMealRecommendations(
          mealTime,
          mealCalories,
          mealProtein,
          mealCarbs,
          goal.objective,
          isTrainingDay
        );
      }

      // Calculate totals
      const totalNutrition = this.calculateTotalNutrition(meals);

      // Save to database
      const mealPlanId = await this.saveMealPlan(
        {
          userId,
          planDate,
          totalCalories: totalNutrition.calories,
          totalProtein: totalNutrition.protein,
          totalCarbs: totalNutrition.carbs,
          totalFat: totalNutrition.fat,
          isTrainingDay,
          baseCalories: tdee,
          workoutAdjustment: workoutCalories,
        },
        meals,
        mealTimes
      );

      return {
        mealPlanId: mealPlanId,
        planDate: planDate,
        isTrainingDay,
        meals,
        totalNutrition,
        targetNutrition: {
          calories: targetCalories,
          protein: macros.proteinG,
          carbs: macros.carbsG,
          fat: macros.fatG,
        },
      };
    }
  }

  // Generate meals

  private calculateTotalNutrition(meals: any): any {
    let total = { calories: 0, protein: 0, carbs: 0, fat: 0 };

    Object.values(meals).forEach((mealFoods: any) => {
      mealFoods.forEach((food: FoodRecommendation) => {
        const multiplier = food.servingSuggestion / 100;
        total.calories += food.calories * multiplier;
        total.protein += food.protein * multiplier;
        total.carbs += food.carbs * multiplier;
        total.fat += food.fat * multiplier;
      });
    });

    return {
      calories: Math.round(total.calories),
      protein: Math.round(total.protein),
      carbs: Math.round(total.carbs),
      fat: Math.round(total.fat),
    };
  }

  private async saveMealPlan(
    plan: MealPlan,
    meals: any,
    mealTimes: MealTime[]
  ): Promise<string> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      // Insert meal plan
      const planQuery = `
        INSERT INTO meal_plans (
          user_id, plan_date, total_calories, total_protein, total_carbs, total_fat,
          is_training_day, base_calories, workout_adjustment, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'generated')
        RETURNING id
      `;

      const planResult = await client.query(planQuery, [
        plan.userId,
        plan.planDate,
        plan.totalCalories,
        plan.totalProtein,
        plan.totalCarbs,
        plan.totalFat,
        plan.isTrainingDay,
        plan.baseCalories,
        plan.workoutAdjustment,
      ]);

      const mealPlanId = planResult.rows[0].id;

      // Insert meal items
      for (const mealTime of mealTimes) {
        const mealFoods = meals[mealTime.code] || [];

        for (let i = 0; i < mealFoods.length; i++) {
          const food = mealFoods[i];
          const multiplier = food.servingSuggestion / 100;

          const itemQuery = `
            INSERT INTO meal_plan_items (
              meal_plan_id, meal_time_id, food_id, food_name,
              servings, calories, protein, carbs, fat, display_order
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `;

          await client.query(itemQuery, [
            mealPlanId,
            mealTime.id,
            food.foodId,
            food.foodNameVi || food.foodName,
            food.servingSuggestion,
            Math.round(food.calories * multiplier),
            Math.round(food.protein * multiplier * 10) / 10,
            Math.round(food.carbs * multiplier * 10) / 10,
            Math.round(food.fat * multiplier * 10) / 10,
            i,
          ]);
        }
      }

      await client.query("COMMIT");
      return mealPlanId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async saveNutritionTarget(
    userId: string,
    goadId: string,
    calories: number,
    protein: number,
    carbs: number,
    fat: number,
    bmr: number,
    tdee: number,
    goalType: Objective
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Insert meal plan
      const nutritionQuery = `
        INSERT INTO nutrition_targets (
          user_id, goal_id, calories_kcal, protein_g, fat_g, carbs_g,
          bmr, tdee, goal_type, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'true')
        RETURNING id
      `;

      const nutritionTargetResult = await client.query(nutritionQuery, [
        userId,
        goadId,
        calories,
        protein,
        fat,
        carbs,
        bmr,
        tdee,
        goalType,
      ]);
      const nutritionTargetId = nutritionTargetResult.rows[0].id;
      await client.query("COMMIT");
      return nutritionTargetId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private buildMealQuery(
    mealTime: MealTime,
    objective: Objective,
    isTrainingDay: boolean,
    targetCalories: number,
    targetProtein: number,
    targetCarbs: number,
    // Thêm tham số mới để xác định thời điểm liên quan đến buổi tập
    workoutContext?: "pre-workout" | "post-workout"
  ): string {
    // 1. Bắt đầu với vai trò và yêu cầu cơ bản
    let query = `Bạn là chuyên gia dinh dưỡng Gym. Gợi ý cho tôi một món ăn cho ${mealTime.nameVi}. với ${targetCalories} calories bao gồm ${targetProtein} protein và ${targetCarbs} carbs. `;

    // 2. Thêm mục tiêu chính
    const objectiveMap = {
      [Objective.GAIN_MUSCLE]:
        "Món ăn này cần giúp tăng cơ nạc, giàu protein nhưng hạn chế chất béo không cần thiết. ",
      [Objective.LOSE_FAT]:
        "Món ăn này cần hỗ trợ giảm mỡ, ít calo, ít đường và dầu mỡ. ",
      [Objective.ENDURANCE]:
        "Món ăn này cần tối ưu cho sức bền, cung cấp nhiều carb phức. ",
      [Objective.MAINTAIN]: "",
    };
    if (objectiveMap[objective]) {
      query += objectiveMap[objective];
    }

    // 3. Thêm ngữ cảnh ngày tập (chi tiết hơn)
    if (isTrainingDay && workoutContext) {
      if (workoutContext === "pre-workout") {
        query +=
          "Đây là bữa ăn quan trọng trước buổi tập, cần cung cấp năng lượng bền bỉ và dễ tiêu hóa. ";
      } else if (workoutContext === "post-workout") {
        query +=
          "Đây là bữa ăn phục hồi sau tập, cần protein hấp thu tốt để sửa chữa cơ bắp. ";
      }
    }

    // 4. Thêm các sở thích chung
    query += "Ưu tiên các phương pháp chế biến lành mạnh như luộc, hấp, nướng.";

    return query;
  }

  private async checkTargetNutritionAlready(
    userId: string,
    goalId: string
  ): Promise<any> {
    const result = await this.pool.query(
      `
      SELECT
      nt.id,
    nt.user_id as userId,
    nt.goal_id as goalId,
    nt.calories_kcal as caloriesKcal,
    nt.protein_g as proteinG,
    nt.fat_g as fatG,
    nt.carbs_g as carbsG,
    nt.bmr,
    nt.tdee,
    nt.goal_type
    FROM nutrition_targets nt
    WHERE user_id = $1 AND goal_id = $2 AND is_active = true
    `,
      [userId, goalId]
    );
    return result.rows[0];
  }

  /**
   * must: -> check mp exist -> lay id food, gen food.
   */

  private async getMealPlanByUserIdAndPlanDate(
    userId: string,
    planDate: string
  ) {
    const result = await this.pool.query(
      `
      SELECT
        mp.id as mealPlanId,
        mp.user_id as userId,
        mp.plan_date as planDate,
        mp.total_calories as totalCalories,
        mp.total_protein as totalProtein,
        mp.total_carbs as totalCarbs,
        mp.total_fat as totalFat,
        mp.is_training_day isTrainingDay,
        mp.base_calories as baseCalories,
        mpi.display_order as displayOrder,
        mpi.servings,
        f.food_name as foodName,
        f.food_name_vi as foodNameVi,
        f.calories as foodCalories,
        f.protein as foodProtein,
        f.carbs as foodCarbs,
        f.fat as foodFat,
        f.fiber as foodFiber,
        f.image_url as foodImage,
        f.detailed_benefits as foodBenefits,
        mt.code as nealtimecode
      FROM meal_plans mp
      JOIN meal_plan_items mpi
      ON mp.id = mpi.meal_plan_id
      JOIN meal_times mt on mpi.meal_time_id = mt.id
      JOIN foods f ON mpi.food_id = f.id
      WHERE user_id = $1 AND plan_date = $2
    `,
      [userId, planDate]
    );
    const resultMealPlan = result.rows;

    const mealPlanId = resultMealPlan[0].mealplanid;
    const mealPlanDate = resultMealPlan[0].plandate;
    const isTrainingDay = resultMealPlan[0].istrainingday;

    const meals: any = {};

    const groupedMeals = resultMealPlan.reduce((acc, meal) => {
      const key = meal.nealtimecode;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(meal);
      return acc;
    }, {} as Record<string, typeof meals>);

    return {
      mealPlanId,
      planDate: mealPlanDate,
      isTrainingDay,
      meals: groupedMeals,
      // targetNutrition: {
      //   calories: targetCalories,
      //   protein: macros.proteinG,
      //   carbs: macros.carbsG,
      //   fat: macros.fatG,
      // },
    };
  }

  private async getProfile(userId: string) {
    const profileResult = await this.pool.query(
      `
      SELECT 
        up.user_id as "userId",
        up.full_name as "fullName",
        up.gender,
        up.height_cm as "heightCm",
        up.weight_kg as "weightKg",
        up.bmi,
        up.fitness_level as "fitnessLevel",
        up.age
      FROM user_profiles up
      WHERE up.user_id = $1 AND up.is_deleted = false
    `,
      [userId]
    );
    return profileResult.rows[0];
  }
  private async getGoalByUser(userId: string) {
    const goalResult = await this.pool.query(
      `
      SELECT id, objective, sessions_per_week as "sessionsPerWeek"
      FROM goals
      WHERE user_id = $1 AND status = 'ACTIVE' AND is_deleted = false
      ORDER BY created_at DESC
      LIMIT 1
    `,
      [userId]
    );
    return goalResult.rows[0];
  }
}

export const mealPlanGenerator = new MealPlanGenerator();
