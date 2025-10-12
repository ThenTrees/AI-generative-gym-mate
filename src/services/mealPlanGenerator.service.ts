import { userProfileSchema } from "./../utils/validators";
import { Pool } from "pg";
import { MealTime } from "../types/model/mealTime";
import { DATABASE_CONFIG } from "../configs/database";
import { Objective } from "../common/common-enum";
import { MealPlan } from "../types/model/mealPlan";
import { FoodRecommendation } from "../types/model/foodRecommendation";
import { NutritionTarget } from "../types/model/nutritionTarget";
import { convertDateFormat } from "../utils/convert";
import {
  NutritionCalculationService,
  UserProfile,
  Goal,
  NutritionTarget as CalculatedNutritionTarget,
} from "./NutritionCalculation.service";
import {
  MealRecommendationService,
  MealContext,
} from "./MealRecommendation.service";

export class MealPlanGenerator {
  private pool: Pool;
  private nutritionCalculationService: NutritionCalculationService;
  private mealRecommendationService: MealRecommendationService;

  constructor() {
    this.pool = new Pool({
      ...DATABASE_CONFIG,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    this.nutritionCalculationService = new NutritionCalculationService();
    this.mealRecommendationService = new MealRecommendationService();
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
    const context: MealContext = {
      mealTime,
      targetCalories,
      targetProtein,
      targetCarbs,
      objective,
      isTrainingDay,
      workoutContext,
    };

    return this.mealRecommendationService.generateMealRecommendations(context);
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
    // Get or calculate nutrition targets
    const nutritionTarget = await this.getOrCalculateNutritionTarget(
      userId,
      profile,
      goal,
      isTrainingDay,
      workoutCalories
    );

    console.log("\n🎯 Nutrition targets:");
    console.log(`  BMR: ${nutritionTarget.bmr} kcal`);
    console.log(`  TDEE: ${nutritionTarget.tdee} kcal`);
    console.log(`  Target: ${nutritionTarget.targetCalories} kcal`);
    console.log(`  Protein: ${nutritionTarget.macros.proteinG}g`);
    console.log(`  Carbs: ${nutritionTarget.macros.carbsG}g`);
    console.log(`  Fat: ${nutritionTarget.macros.fatG}g`);

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
      return {
        ...mealPlanExist,
        targetNutrition: {
          calories: nutritionTarget.targetCalories,
          protein: nutritionTarget.macros.proteinG,
          carbs: nutritionTarget.macros.carbsG,
          fat: nutritionTarget.macros.fatG,
        },
      };
    } else {
      /**
       * Generate meal recommendations for each meal time
       */
      for (const mealTime of mealTimes) {
        const mealNutrition =
          this.nutritionCalculationService.calculateMealNutrition(
            nutritionTarget,
            mealTime.defaultCaloriePercentage
          );

        meals[mealTime.code] = await this.generateMealRecommendations(
          mealTime,
          mealNutrition.calories,
          mealNutrition.protein,
          mealNutrition.carbs,
          goal.objective,
          isTrainingDay
        );
      }

      // Save to database
      const mealPlanId = await this.saveMealPlan(
        {
          userId,
          planDate,
          totalCalories: 0,
          totalProtein: 0,
          totalCarbs: 0,
          totalFat: 0,
          isTrainingDay,
          baseCalories: nutritionTarget.tdee,
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
        actualNutrition: {
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
        },
        targetNutrition: {
          calories: nutritionTarget.targetCalories,
          protein: nutritionTarget.macros.proteinG,
          carbs: nutritionTarget.macros.carbsG,
          fat: nutritionTarget.macros.fatG,
        },
      };
    }
  }

  async updateMealPlanItemStatus(
    mealPlanItemId: string,
    mealPlanId: string,
    mealTimeId: string,
    foodId: string
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Insert meal plan
      const updateMealPlanItemStatus = `
        Update INTO meal_plan_items 
        SET is_completed = true, completed_at = NOW()
        WHERE id = $1 AND meal_plan_id = $2 AND meal_time_id = $3 AND food_id = $4
      `;

      const updateMealPlanItemStatusResult = await client.query(
        updateMealPlanItemStatus,
        [mealPlanItemId, mealPlanId, mealTimeId, foodId]
      );
      await client.query("COMMIT");

      return updateMealPlanItemStatusResult;
    } catch (error) {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }

  /**
   * Get existing nutrition target or calculate new one
   */
  private async getOrCalculateNutritionTarget(
    userId: string,
    profile: UserProfile,
    goal: Goal,
    isTrainingDay: boolean,
    workoutCalories: number
  ): Promise<CalculatedNutritionTarget> {
    // Check if nutrition target already exists
    const existingTarget = await this.checkTargetNutritionAlready(
      userId,
      goal.id
    );

    if (existingTarget) {
      return {
        bmr: existingTarget.bmr,
        tdee: existingTarget.tdee,
        targetCalories: existingTarget.calorieskcal,
        macros: {
          proteinG: existingTarget.proteing,
          carbsG: existingTarget.carbsg,
          fatG: existingTarget.fatg,
        },
      };
    }

    // Calculate new nutrition target
    const nutritionTarget =
      this.nutritionCalculationService.calculateNutritionTarget(
        profile,
        goal,
        isTrainingDay,
        workoutCalories
      );

    // Save to database
    await this.saveNutritionTarget(
      userId,
      goal.id,
      nutritionTarget.targetCalories,
      nutritionTarget.macros.proteinG,
      nutritionTarget.macros.carbsG,
      nutritionTarget.macros.fatG,
      nutritionTarget.bmr,
      nutritionTarget.tdee,
      goal.objective
    );

    return nutritionTarget;
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
        mpi.id as mealPlanItemId,
        mpi.meal_time_id as mealTimeId,
        mpi.servings,
        mpi.is_completed as completed,
        f.food_name as foodName,
        f.food_name_vi as foodNameVi,
        f.calories as foodCalories,
        f.protein as foodProtein,
        f.carbs as foodCarbs,
        f.fat as foodFat,
        f.fiber as foodFiber,
        f.image_url as foodImage,
        f.detailed_benefits as foodBenefits,
        mt.code as mealtimecode
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
    if (resultMealPlan.length === 0) {
      return null;
    }
    const mealPlanId = resultMealPlan[0].mealPlanId;
    const mealPlanDate = resultMealPlan[0].planDate;
    const isTrainingDay = resultMealPlan[0].isTrainingDay;
    const actualNutrition = {
      calories: resultMealPlan[0].totalcalories,
      protein: resultMealPlan[0].totalprotein,
      carbs: resultMealPlan[0].totalcarbs,
      fat: resultMealPlan[0].totalfat,
    };

    const meals: any = {};

    const groupedMeals = resultMealPlan.reduce((acc, meal) => {
      const key = meal.mealtimecode;
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
      actualNutrition,
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
