import { Pool, types } from "pg";
import { MealTime } from "../types/model/mealTime";
import { DATABASE_CONFIG } from "../configs/database";
import { Objective } from "../common/common-enum";
import { MealPlan } from "../types/model/mealPlan";
import { FoodRecommendation } from "../types/model/foodRecommendation";
import { convertDateFormat } from "../utils/convert";
import { logger } from "../utils/logger";
import { foodVectorService } from "./foodVector.service";
import { Food } from "../types/model/food";
import {
  NutritionCalculationService,
  NutritionTarget as CalculatedNutritionTarget,
  MealNutrition,
} from "./NutritionCalculation.service";
import {
  MealContext,
  MealRecommendationService,
} from "./MealRecommendation.service";
import { UserProfile } from "../types/model/userProfile.model";
import { Goal } from "../types/model/goal.model";
types.setTypeParser(1082, (val) => val);
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

  private async checkScheduleWorkout(userId: string, planDate: string) {
    const client = await this.pool.connect();
    try {
      const query = `
      SELECT p.id FROM plans p
      JOIN plan_days pd ON p.id = pd.plan_id
      WHERE p.user_id = $1 AND pd.scheduled_date = $2
      `;
      const result = await client.query(query, [userId, planDate]);
      if (result.rows.length > 0) return result.rows[0] || null;
    } catch (error: any) {
      logger.error("get scheduled workout failed!");
      throw error;
    } finally {
      client.release();
    }
  }

  async getMealPlanUserId(userId: string, mealPlanDate: Date) {
    const profile = await this.getProfile(userId);
    if (!profile) {
      throw new Error("User profile not found");
    }

    const goal = await this.getGoalByUser(userId);
    if (!goal) {
      throw new Error("No active goal found");
    }

    const transferDate = convertDateFormat(mealPlanDate.toLocaleDateString());

    let isTrainingDay = false;

    // Check if training day
    const trainingDay = await this.checkScheduleWorkout(userId, transferDate);
    if (trainingDay) {
      isTrainingDay = true;
    }
    let workoutCalories = 0;

    if (isTrainingDay) {
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

    // get meal plan for current day by userId
    const mealPlanResult = await this.getMealPlanByUserIdAndPlanDate(
      userId,
      transferDate
    );

    // Return unified response shape
    return this.buildUnifiedResponse(
      mealPlanResult,
      nutritionTarget,
      transferDate
    );
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
    targetFat: number,
    objective: Objective,
    isTrainingDay: boolean,
    userId: string,
    userWeight: number,
    userHeight: number,
    userGender: string
  ): Promise<FoodRecommendation[]> {
    const context: MealContext = {
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
    };

    return this.mealRecommendationService.generateMealRecommendations(
      context,
      userId
    );
  }

  /**
   * Generate complete meal plan
   */
  async generateDayMealPlan(userId: string, planDate: Date): Promise<any> {
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
    const planDateTransfer = convertDateFormat(planDate.toLocaleDateString());
    // Check if training day
    let isTrainingDay = false;

    // Check if training day
    const trainingDay = await this.checkScheduleWorkout(
      userId,
      planDateTransfer
    );
    if (trainingDay) {
      isTrainingDay = true;
    }
    let workoutCalories = 0;
    if (isTrainingDay) {
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
    logger.info("🎯 Nutrition targets:");
    logger.info(`BMR: ${nutritionTarget.bmr} kcal`);
    logger.info(`TDEE: ${nutritionTarget.tdee} kcal`);
    logger.info(`Target: ${nutritionTarget.targetCalories} kcal`);
    logger.info(`Protein: ${nutritionTarget.macros.proteinG}g`);
    logger.info(`Carbs: ${nutritionTarget.macros.carbsG}g`);
    logger.info(`Fat: ${nutritionTarget.macros.fatG}g`);

    // Get meal times
    const mealTimes = await this.getMealTimes();

    logger.info("🍽️  Generating meal plan...");

    const mealPlanExist = await this.getMealPlanByUserIdAndPlanDate(
      userId,
      planDateTransfer
    );

    // check meal plan already exist
    if (mealPlanExist) {
      // Return unified response shape
      return this.buildUnifiedResponse(
        mealPlanExist,
        nutritionTarget,
        planDateTransfer
      );
    }

    /**
     * Generate meal recommendations for each meal time
     */
    const meals: any = {};
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
        mealNutrition.fat,
        goal.objectiveType,
        isTrainingDay,
        userId,
        profile.weightKg,
        profile.heightCm,
        profile.gender
      );
    }

    // ✅ Enforce white rice rule: bữa trưa luôn có cơm HOẶC cách 1 bữa phải có cơm trắng
    await this.enforceWhiteRiceRule(meals, mealTimes, nutritionTarget);

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

    // Format response to match existing plan response shape
    const formattedMeals: any = {};
    for (const mealTime of mealTimes) {
      const mealFoods = meals[mealTime.code] || [];
      formattedMeals[mealTime.code] = mealFoods.map(
        (food: FoodRecommendation, index: number) => {
          const multiplier = food.servingSuggestion / 100;
          return {
            mealTimeId: mealTime.id,
            servings: food.servingSuggestion,
            completed: false,
            displayOrder: index,
            nutrition: {
              calories: Math.round(food.calories * multiplier),
              protein: Math.round(food.protein * multiplier * 10) / 10,
              carbs: Math.round(food.carbs * multiplier * 10) / 10,
              fat: Math.round(food.fat * multiplier * 10) / 10,
            },
            food: {
              id: food.id || "",
              name: food.foodName || "",
              nameVi: food.foodNameVi || food.foodName || "",
              description: food.description,
              commonCombinations: food.commonCombinations,
              calories: food.calories,
              protein: food.protein,
              carbs: food.carbs,
              fat: food.fat,
              fiber: food.fiber,
              category: food.category,
              image: food.imageUrl,
              benefits: food.detailedBenefits,
            },
          };
        }
      );
    }

    return {
      mealPlanId: mealPlanId,
      planDate: planDateTransfer,
      isTrainingDay,
      meals: formattedMeals,
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
        caloriesForBreakfast: nutritionTarget.caloriesForBreakfast,
        caloriesForLunch: nutritionTarget.caloriesForLunch,
        caloriesForDinner: nutritionTarget.caloriesForDiner,
        isTrainingDay: nutritionTarget.isTraining,
      },
    };
  }

  // link to meal plan => update macro
  async updateMealPlanItemStatus(mealPlanItemId: string, completed: boolean) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const itemQuery = await client.query(
        `SELECT 
           mpi.meal_plan_id, 
           mpi.is_completed
         FROM meal_plan_items mpi
         WHERE mpi.id = $1 FOR UPDATE`, // "FOR UPDATE" để khóa hàng này lại
        [mealPlanItemId]
      );

      if (itemQuery.rows.length === 0) {
        throw new Error("Meal plan item not found");
      }

      const itemData = itemQuery.rows[0];
      const oldCompletedStatus = itemData.is_completed;
      if (oldCompletedStatus !== completed) {
        // Insert meal plan
        const updateMealPlanItemStatus = `
        UPDATE meal_plan_items 
        SET 
          is_completed = $1, 
          completed_at = CASE WHEN $1 = true THEN NOW() ELSE NULL END
        WHERE id = $2
        RETURNING id, meal_plan_id, servings, calories, protein, carbs, fat 
      `;
        const updateMealPlanItemStatusResult = await client.query(
          updateMealPlanItemStatus,
          [completed, mealPlanItemId]
        );
        await client.query("COMMIT");

        const operator = completed ? "+" : "-";

        await this.updateMacroMealPlan(
          updateMealPlanItemStatusResult.rows[0].meal_plan_id,
          parseFloat(updateMealPlanItemStatusResult.rows[0].calories),
          parseFloat(updateMealPlanItemStatusResult.rows[0].protein),
          parseFloat(updateMealPlanItemStatusResult.rows[0].carbs),
          parseFloat(updateMealPlanItemStatusResult.rows[0].fat),
          operator
        );
      }
    } catch (error: any) {
      logger.error("completed food error: ", error.message);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }

  // add food into meal plan => insert new record meal plan item
  async addFoodIntoMealPlan(
    mealPlanId: string,
    mealTimeId: string,
    foodId: string,
    servings: number
  ) {
    try {
      // check exist in meal plan item
      const mealPlanItemExist = await this.checkMealPlanExist(
        mealPlanId,
        mealTimeId,
        foodId
      );
      if (mealPlanItemExist) {
        throw new Error("food exist in meal plan!");
      }
      // check meal plan already exist
      const mealPlan = await this.getMealPlanById(mealPlanId);
      if (!mealPlan) {
        throw new Error("Meal plan not found!");
      }
      // get meal time | skip
      // get info food id || TODO:
      const foodList: Food[] = await foodVectorService.getFoodsByIds([foodId]);
      const food = foodList[0];
      const calories = Math.round(
        (servings * food.calories) / food.servingWeightGrams
      );
      const protein = Math.round(
        (servings * food.protein) / food.servingWeightGrams
      );
      const carbs = Math.round(
        (servings * food.carbs) / food.servingWeightGrams
      );
      const fat = Math.round((servings * food.fat) / food.servingWeightGrams);
      await this.saveMealPlanItem(
        mealPlanId,
        mealTimeId,
        foodId,
        food.foodNameVi,
        servings,
        calories,
        protein,
        carbs,
        fat
      );
    } catch (error) {
      logger.error("add meal plan item failed!");
      throw error;
    }
  }

  private async getMealPlanById(mealPlanId: string) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT mp
        FROM meal_plans mp
        WHERE mp.id = $1
      `;
      const result = await client.query(query, [mealPlanId]);
      return result.rows[0] || null;
    } catch (error: any) {
      logger.error("GET meal plan failed!: ", error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  private async getMealPlanByUserIdAndDate(
    userId: string,
    mealPlanDate: string
  ) {
    const client = await this.pool.connect();
    try {
      const query = `
        SELECT mp
        FROM meal_plans mp
        WHERE mp.user_id = $1 AND mp.plan_date = $2
      `;
      const result = await client.query(query, [userId, mealPlanDate]);
      return result.rows[0] || null;
    } catch (error: any) {
      logger.error("GET meal plan failed!: ", error.message);
      throw error;
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
      goal.id,
      isTrainingDay
    );

    if (existingTarget) {
      return {
        bmr: existingTarget.bmr,
        tdee: existingTarget.tdee,
        targetCalories: existingTarget.caloriesKcal,
        macros: {
          proteinG: existingTarget.proteinG,
          carbsG: existingTarget.carbsG,
          fatG: existingTarget.fatG,
        },
        caloriesForBreakfast: parseInt(existingTarget.suggestForBreakfast),
        caloriesForLunch: parseInt(existingTarget.suggestForLunch),
        caloriesForDiner: parseInt(existingTarget.suggestForDinner),
        isTraining: existingTarget.isTraining,
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

    const mealTimes = await this.getMealTimes();

    const allMealNutritions: Array<{
      mealTime: string;
      nutrition: MealNutrition;
    }> = [];
    for (const mealTime of mealTimes) {
      const mealNutrition =
        this.nutritionCalculationService.calculateMealNutrition(
          nutritionTarget,
          mealTime.defaultCaloriePercentage
        );

      allMealNutritions.push({
        mealTime: mealTime.code,
        nutrition: mealNutrition,
      });
    }
    const mealNutritionMap = allMealNutritions.reduce<
      Record<string, MealNutrition>
    >((acc, entry) => {
      acc[entry.mealTime] = entry.nutrition;
      return acc;
    }, {});
    const orderedMealCodes = mealTimes.map((mealTime) => mealTime.code);
    const getMealCalories = (
      preferredCodes: string[],
      fallbackIndex: number
    ) => {
      for (const code of preferredCodes) {
        if (mealNutritionMap[code]) {
          return mealNutritionMap[code].calories;
        }
      }
      const fallbackCode = orderedMealCodes[fallbackIndex];
      if (fallbackCode && mealNutritionMap[fallbackCode]) {
        return mealNutritionMap[fallbackCode].calories;
      }
      return 0;
    };

    const caloriesForBreakfast = getMealCalories(["BREAKFAST"], 0);
    const caloriesForLunch = getMealCalories(["LUNCH"], 1);
    const caloriesForDinner = getMealCalories(["DINNER"], 2);
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
      goal.objectiveType,
      caloriesForBreakfast,
      caloriesForLunch,
      caloriesForDinner,
      isTrainingDay
    );

    return {
      ...nutritionTarget,
      caloriesForBreakfast,
      caloriesForLunch,
      caloriesForDiner: caloriesForDinner,
      isTraining: isTrainingDay,
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
    goalId: string,
    calories: number,
    protein: number,
    carbs: number,
    fat: number,
    bmr: number,
    tdee: number,
    goalType: Objective,
    caloriesForBreakfast: number,
    caloriesForLunch: number,
    caloriesForDiner: number,
    isTraining: boolean
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Insert meal plan
      const nutritionQuery = `
        INSERT INTO nutrition_targets (
          user_id, goal_id, calories_kcal, protein_g, carbs_g, fat_g,
          bmr, tdee, goal_type, is_active, suggestion_calories_for_breakfast, suggestion_calories_for_lunch, suggestion_calories_for_dinner, is_training
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'true', $10, $11, $12, $13)
        RETURNING id
      `;

      const nutritionTargetResult = await client.query(nutritionQuery, [
        userId,
        goalId,
        calories,
        protein,
        carbs,
        fat,
        bmr,
        tdee,
        goalType,
        caloriesForBreakfast,
        caloriesForLunch,
        caloriesForDiner,
        isTraining,
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
    goalId: string,
    isTraining: boolean
  ): Promise<any> {
    const result = await this.pool.query(
      `
      SELECT
        nt.id,
        nt.user_id as "userId",
        nt.goal_id as "goalId",
        nt.calories_kcal as "caloriesKcal",
        nt.protein_g as "proteinG",
        nt.fat_g as "fatG",
        nt.carbs_g as "carbsG",
        nt.bmr,
        nt.tdee,
        nt.goal_type,
        nt.suggestion_calories_for_breakfast as "suggestForBreakfast",
        nt.suggestion_calories_for_lunch as "suggestForLunch",
        nt.suggestion_calories_for_dinner as "suggestForDinner",
        nt.is_training as "isTraining"
    FROM nutrition_targets nt
    WHERE user_id = $1 AND goal_id = $2 AND is_training = $3 AND is_active = true
    `,
      [userId, goalId, isTraining]
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
        mp.id as "mealPlanId",
        mp.plan_date as "planDate",
        mp.base_calories as "baseCalories",
        mp.is_training_day as "isTrainingDay",
        mp.total_calories as "totalCalories",
        mp.total_protein as "totalProtein",
        mp.total_carbs as "totalCarbs",
        mp.total_fat as "totalFat",
        mpi.display_order as "displayOrder",
        mpi.id as "mealPlanItemId",
        mpi.meal_time_id as "mealTimeId",
        mpi.servings as "servings",
        mpi.is_completed as "completed",
        mpi.calories as "itemCalories",
        mpi.protein as "itemProtein",
        mpi.carbs as "itemCarbs",
        mpi.fat as "itemFat",
        f.id as "foodId",
        f.food_name as "foodName",
        f.food_name_vi as "foodNameVi",
        f.description as "description",
        f.common_combinations as "commonCombinations",
        f.calories as "foodCalories",
        f.protein as "foodProtein",
        f.carbs as "foodCarbs",
        f.fat as "foodFat",
        f.fiber as "foodFiber",
        f.category as "category",
        f.image_url as "foodImage",
        f.detailed_benefits as "foodBenefits",
        mt.code as "mealTimeCode"
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
      calories: resultMealPlan[0].totalCalories || 0,
      protein: resultMealPlan[0].totalProtein || 0,
      carbs: resultMealPlan[0].totalCarbs || 0,
      fat: resultMealPlan[0].totalFat || 0,
    };

    const groupedMeals = resultMealPlan.reduce<Record<string, any[]>>(
      (acc, meal) => {
        const key = meal.mealTimeCode;
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push({
          mealPlanItemId: meal.mealPlanItemId,
          mealTimeId: meal.mealTimeId,
          servings: meal.servings,
          completed: meal.completed,
          displayOrder: meal.displayOrder,
          nutrition: {
            calories: meal.itemCalories,
            protein: meal.itemProtein,
            carbs: meal.itemCarbs,
            fat: meal.itemFat,
          },
          food: {
            id: meal.foodId,
            name: meal.foodName,
            nameVi: meal.foodNameVi,
            description: meal.description,
            commonCombinations: meal.commonCombinations,
            calories: meal.foodCalories,
            protein: meal.foodProtein,
            carbs: meal.foodCarbs,
            fat: meal.foodFat,
            fiber: meal.foodFiber,
            category: meal.category,
            image: meal.foodImage,
            benefits: meal.foodBenefits,
          },
        });
        return acc;
      },
      {}
    );

    return {
      mealPlanId,
      planDate: mealPlanDate,
      isTrainingDay,
      meals: groupedMeals,
      actualNutrition,
    };
  }

  async getProfile(userId: string) {
    const profileResult = await this.pool.query(
      `
      SELECT 
        up.user_id as "userId",
        up.full_name as "fullName",
        up.gender,
        up.height_cm as "height",
        up.weight_kg as "weight",
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

  async getGoalByUser(userId: string) {
    const goalResult = await this.pool.query(
      `
      SELECT id, objective as "objectiveType", sessions_per_week as "sessionsPerWeek",
      session_minutes as "sessionMinutes"
      FROM goals
      WHERE user_id = $1 AND status = 'ACTIVE' AND is_deleted = false
      ORDER BY created_at DESC
      LIMIT 1
    `,
      [userId]
    );
    return goalResult.rows[0];
  }

  private async saveMealPlanItem(
    mealPlanId: string,
    mealTimeId: string,
    foodId: string,
    nameVi: string,
    servings: number,
    calories: number,
    protein: number,
    carbs: number,
    fat: number
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const itemQuery = `
            INSERT INTO meal_plan_items (
              meal_plan_id, meal_time_id, food_id, food_name,
              servings, calories, protein, carbs, fat, display_order
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0)
          `;

      await client.query(itemQuery, [
        mealPlanId,
        mealTimeId,
        foodId,
        nameVi,
        servings,
        calories,
        protein,
        carbs,
        fat,
      ]);
      await client.query("COMMIT");
    } catch (error: any) {
      logger.error("insert into table meal plan item failed!: ", error.message);
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async updateMacroMealPlan(
    mealPlanId: string,
    totalCalories: number,
    protein: number,
    carbs: number,
    fat: number,
    operator: string
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Insert meal plan
      const updateMealPlanQuery = `
        UPDATE meal_plans
        SET total_calories = total_calories ${operator} $1,
            total_protein = total_protein ${operator} $2,
            total_carbs = total_carbs ${operator} $3,
            total_fat = total_fat ${operator} $4
        WHERE id = $5
      `;

      const mealPlanResult = await client.query(updateMealPlanQuery, [
        totalCalories,
        protein,
        carbs,
        fat,
        mealPlanId,
      ]);

      await client.query("COMMIT");
    } catch (error: any) {
      logger.error("UPDATE meal plan is failed!: ", error.message);
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async checkMealPlanExist(
    mealPlanId: string,
    mealTimeId: string,
    foodId: string
  ) {
    const client = await this.pool.connect();
    try {
      const query = `
      SELECT mpi
      FROM meal_plan_items mpi
      WHERE mpi.meal_plan_id = $1 AND meal_time_id = $2 AND food_id = $3
      `;

      const result = await client.query(query, [
        mealPlanId,
        mealTimeId,
        foodId,
      ]);
      return result.rows.length > 0;
    } catch (error: any) {
      logger.error("check meal plan exist failed!: ", error.message);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * ✅ Build unified response shape for both new and existing meal plans
   */
  private buildUnifiedResponse(
    mealPlanResult: any,
    nutritionTarget: any,
    planDate: string
  ) {
    if (!mealPlanResult) {
      return null;
    }

    return {
      mealPlanId: mealPlanResult.mealPlanId,
      planDate: planDate,
      isTrainingDay: mealPlanResult.isTrainingDay,
      meals: mealPlanResult.meals,
      actualNutrition: mealPlanResult.actualNutrition || {
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
        caloriesForBreakfast: nutritionTarget.caloriesForBreakfast,
        caloriesForLunch: nutritionTarget.caloriesForLunch,
        caloriesForDinner: nutritionTarget.caloriesForDiner,
        isTrainingDay: nutritionTarget.isTraining,
      },
    };
  }

  /**
   * ✅ Enforce business rule: Bữa trưa luôn có cơm HOẶC cách 1 bữa phải có cơm trắng
   * Priority: Lunch > Dinner > Breakfast
   */
  private async enforceWhiteRiceRule(
    meals: any,
    mealTimes: MealTime[],
    nutritionTarget: any
  ): Promise<void> {
    logger.info("🍚 Checking white rice rule...");

    // Find meal time codes
    const lunchCode = mealTimes.find((mt) => mt.code === "LUNCH")?.code;
    const dinnerCode = mealTimes.find((mt) => mt.code === "DINNER")?.code;
    const breakfastCode = mealTimes.find((mt) => mt.code === "BREAKFAST")?.code;

    // Check if white rice exists in any meal
    const hasRiceInLunch = this.hasWhiteRice(meals[lunchCode || ""] || []);
    const hasRiceInDinner = this.hasWhiteRice(meals[dinnerCode || ""] || []);
    const hasRiceInBreakfast = this.hasWhiteRice(
      meals[breakfastCode || ""] || []
    );

    const hasRiceInAnyMeal =
      hasRiceInLunch || hasRiceInDinner || hasRiceInBreakfast;

    if (hasRiceInAnyMeal) {
      logger.info("✅ White rice already present in meal plan");
      return;
    }

    logger.info(
      "⚠️ No white rice found in meal plan. Enforcing white rice rule..."
    );

    // Priority: Add rice to lunch first, then dinner, then breakfast
    const priorityMeals = [
      { code: lunchCode, name: "Lunch" },
      { code: dinnerCode, name: "Dinner" },
      { code: breakfastCode, name: "Breakfast" },
    ];

    for (const meal of priorityMeals) {
      if (!meal.code || !meals[meal.code]) continue;

      // Find white rice
      const whiteRice = await this.findWhiteRice();
      if (!whiteRice) {
        logger.warn("⚠️ White rice not found in database!");
        break;
      }

      // Calculate appropriate serving for rice
      const mealTimeObj = mealTimes.find((mt) => mt.code === meal.code);
      if (!mealTimeObj) continue;

      const mealNutrition =
        this.nutritionCalculationService.calculateMealNutrition(
          nutritionTarget,
          mealTimeObj.defaultCaloriePercentage
        );

      // Rice should provide about 40-50% of meal carbs
      const targetRiceCarbs = mealNutrition.carbs * 0.45;
      const riceServings = Math.round(
        (targetRiceCarbs / whiteRice.carbs) * 100
      );

      // Find a non-rice carb item to replace
      const mealItems = meals[meal.code];
      const replaceIndex = this.findCarbItemToReplace(mealItems);

      if (replaceIndex >= 0) {
        // Replace existing carb with rice
        const multiplier = riceServings / 100;
        mealItems[replaceIndex] = {
          ...whiteRice,
          servingSuggestion: riceServings,
          score: 100, // High score to ensure it stays
          reason: "Cơm trắng (theo quy tắc dinh dưỡng)",
          targetCalories: Math.round(whiteRice.calories * multiplier),
        };
        logger.info(
          `✅ Replaced item at position ${replaceIndex} in ${meal.name} with white rice (${riceServings}g)`
        );
        break; // Only add rice to one meal
      } else if (mealItems.length < 6) {
        // Or add as new item if meal has space
        const multiplier = riceServings / 100;
        mealItems.push({
          ...whiteRice,
          servingSuggestion: riceServings,
          score: 100,
          reason: "Cơm trắng (theo quy tắc dinh dưỡng)",
          targetCalories: Math.round(whiteRice.calories * multiplier),
        });
        logger.info(`✅ Added white rice to ${meal.name} (${riceServings}g)`);
        break;
      }
    }
  }

  /**
   * Check if meal contains white rice
   */
  private hasWhiteRice(mealItems: any[]): boolean {
    if (!mealItems || mealItems.length === 0) return false;

    return mealItems.some((item) => {
      const foodName = (
        item.foodNameVi ||
        item.foodName ||
        item.food?.nameVi ||
        item.food?.name ||
        ""
      ).toLowerCase();

      return (
        foodName.includes("cơm trắng") ||
        foodName.includes("cơm gạo") ||
        (foodName.includes("cơm") &&
          !foodName.includes("cơm chiên") &&
          !foodName.includes("cơm rang") &&
          !foodName.includes("cơm gà"))
      );
    });
  }

  /**
   * Find white rice from database
   */
  private async findWhiteRice(): Promise<Food | null> {
    try {
      const result = await this.pool.query(
        `
        SELECT 
          id,
          food_name as "foodName",
          food_name_vi as "foodNameVi",
          description,
          serving_weight_grams as "servingWeightGrams",
          calories,
          protein,
          carbs,
          fat,
          fiber,
          category,
          meal_time as "mealTime",
          image_url as "imageUrl",
          detailed_benefits as "detailedBenefits",
          common_combinations as "commonCombinations"
        FROM foods
        WHERE (LOWER(food_name_vi) LIKE '%cơm trắng%' 
           OR LOWER(food_name_vi) LIKE '%cơm gạo%'
           OR LOWER(food_name) LIKE '%white rice%'
           OR LOWER(food_name) LIKE '%steamed rice%')
        AND LOWER(food_name_vi) NOT LIKE '%chiên%'
        AND LOWER(food_name_vi) NOT LIKE '%rang%'
        LIMIT 1
      `
      );

      if (result.rows.length > 0) {
        return result.rows[0];
      }

      // Fallback: find any rice
      const fallbackResult = await this.pool.query(
        `
        SELECT 
          id,
          food_name as "foodName",
          food_name_vi as "foodNameVi",
          description,
          serving_weight_grams as "servingWeightGrams",
          calories,
          protein,
          carbs,
          fat,
          fiber,
          category,
          meal_time as "mealTime",
          image_url as "imageUrl",
          detailed_benefits as "detailedBenefits",
          common_combinations as "commonCombinations"
        FROM foods
        WHERE LOWER(food_name_vi) LIKE '%cơm%'
        AND category IN ('carbs', 'carb', 'carbohydrate')
        LIMIT 1
      `
      );

      return fallbackResult.rows.length > 0 ? fallbackResult.rows[0] : null;
    } catch (error) {
      logger.error("Error finding white rice:", error);
      return null;
    }
  }

  /**
   * Find a carb item (not rice) to replace with white rice
   * Priority: Replace items with lowest score, avoid protein/vegetables
   */
  private findCarbItemToReplace(mealItems: any[]): number {
    if (!mealItems || mealItems.length === 0) return -1;

    // Find carb items that are not already rice
    const carbItems = mealItems
      .map((item, index) => {
        const category = (item.category || "").toLowerCase();
        const foodName = (item.foodNameVi || item.foodName || "").toLowerCase();
        const isCarb =
          category === "carbs" ||
          category === "carb" ||
          foodName.includes("bánh") ||
          foodName.includes("khoai");
        const isAlreadyRice =
          foodName.includes("cơm") || foodName.includes("rice");

        return {
          index,
          isCarb,
          isAlreadyRice,
          score: item.score || 0,
          item,
        };
      })
      .filter((x) => x.isCarb && !x.isAlreadyRice);

    if (carbItems.length === 0) {
      // If no carb items, replace lowest scored non-protein item
      const nonProteinItems = mealItems
        .map((item, index) => ({
          index,
          category: (item.category || "").toLowerCase(),
          score: item.score || 0,
        }))
        .filter((x) => x.category !== "protein" && x.category !== "vegetables");

      if (nonProteinItems.length > 0) {
        const lowest = nonProteinItems.sort((a, b) => a.score - b.score)[0];
        return lowest.index;
      }

      // Last resort: replace lowest scored item
      const sortedByScore = mealItems
        .map((item, index) => ({
          index,
          score: item.score || 0,
        }))
        .sort((a, b) => a.score - b.score);

      return sortedByScore.length > 0 ? sortedByScore[0].index : -1;
    }

    // Replace lowest scored carb item
    const lowestCarb = carbItems.sort((a, b) => a.score - b.score)[0];
    return lowestCarb.index;
  }
}

export const mealPlanGenerator = new MealPlanGenerator();
