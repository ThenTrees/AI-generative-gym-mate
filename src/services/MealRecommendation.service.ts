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
        servingSuggestion,
        targetCalories: maxCalories,
      };
    });

    // Sort by score
    const sortedRecommendations = recommendations
      .sort((a, b) => b.score - a.score);

    // ✅ NEW: Đảm bảo có đủ các nhóm dinh dưỡng trong mỗi bữa (carbs, fruits, protein, fats, vegetables, dairy)
    let topRecommendations = sortedRecommendations.slice(0, NUTRITION_CONSTANTS.MAX_RECOMMENDATIONS);
    
    // ✅ NEW: Giới hạn số lượng mỗi category để tránh quá nhiều cùng loại
    topRecommendations = this.enforceCategoryLimits(topRecommendations, context);
    
    const categoryCount = this.countCategories(topRecommendations);
    
    logger.info(`📊 Category distribution in top ${topRecommendations.length}: ${JSON.stringify(categoryCount)}`);
    
    // ✅ Check missing categories - ưu tiên các category quan trọng
    // Priority: protein, carbs, vegetables (must have) > fruits, dairy, fats (nice to have)
    const mustHaveCategories = ['protein', 'carbs', 'vegetables'];
    const niceToHaveCategories = ['fruits', 'dairy', 'fats'];
    
    const missingMustHave = mustHaveCategories.filter(cat => !categoryCount[cat] || categoryCount[cat] === 0);
    const missingNiceToHave = niceToHaveCategories.filter(cat => !categoryCount[cat] || categoryCount[cat] === 0);
    
    // Chỉ search nếu thiếu must-have categories hoặc thiếu quá nhiều nice-to-have
    const missingCategories = missingMustHave.length > 0 
      ? missingMustHave 
      : missingNiceToHave.length >= 2 ? missingNiceToHave.slice(0, 2) : [];
    
    if (missingCategories.length > 0) {
      logger.info(`🔍 Missing categories for ${context.mealTime.code}: ${missingCategories.join(', ')}`);
      
      // Search for missing categories (limit to max 2-3 để không thay thế quá nhiều)
      const maxReplace = Math.min(missingCategories.length, 3);
      const additionalFoods = await this.searchMissingCategories(
        missingCategories.slice(0, maxReplace),
        context,
        excludedIds,
        maxCalories,
        topRecommendations
      );
      
      if (additionalFoods.length > 0) {
        // Replace lowest scored foods with missing categories
        const replaceCount = Math.min(additionalFoods.length, maxReplace);
        const finalRecommendations = topRecommendations
          .slice(0, NUTRITION_CONSTANTS.MAX_RECOMMENDATIONS - replaceCount);
        
        additionalFoods.slice(0, replaceCount).forEach(food => {
          finalRecommendations.push(food);
        });
        
        logger.info(`✅ Replaced ${replaceCount} foods with missing categories`);
        
        // ✅ Re-enforce category limits after adding new foods
        const finalWithLimits = this.enforceCategoryLimits(finalRecommendations, context);
        return finalWithLimits
          .sort((a, b) => b.score - a.score)
          .slice(0, NUTRITION_CONSTANTS.MAX_RECOMMENDATIONS);
      } else {
        logger.warn(`⚠️ Could not find missing categories: ${missingCategories.join(', ')}`);
      }
    }

    // ✅ NEW: Đảm bảo có ít nhất 1-2 món rau/hạt/củ/sữa cho bữa trưa và tối (fallback logic)
    if (context.mealTime.code === 'lunch' || context.mealTime.code === 'dinner') {
      // topRecommendations đã được define ở trên
      const hasVegetable = topRecommendations.some(food => this.isVegetableOrNut(food));
      
      if (!hasVegetable) {
        // Tìm rau/hạt trong toàn bộ candidates trước
        let vegetableNuts = sortedRecommendations
          .filter(food => this.isVegetableOrNut(food))
          .slice(0, 2);
        
        // ✅ Nếu không có trong candidates, search riêng rau/hạt
        if (vegetableNuts.length === 0) {
          try {
            logger.info(`🔍 No vegetables/nuts found in top results for ${context.mealTime.code}, searching separately...`);
            
            // ✅ Search riêng cho rau/củ - thử nhiều cách
            // Cách 1: Search với category filter
            let vegetableQuery = `Rau xanh và củ quả cho bữa ${context.mealTime.nameVi}, ít calo, nhiều chất xơ, vitamin`;
            let vegetableEmbedding = await this.pgVectorService.embed(vegetableQuery);
            
            let vegetableCandidates = await this.foodVectorService.searchFoodsByVector(
              vegetableEmbedding,
              {
                mealTime: context.mealTime.code,
                maxCalories: maxCalories * 2, // Tăng max calories để có nhiều options hơn
                category: 'vegetable'
              },
              excludedIds,
              15
            );
            
            // ✅ Cách 2: Nếu không có, search không có category filter
            if (!vegetableCandidates || vegetableCandidates.length === 0) {
              logger.warn(`No vegetables found with category filter, trying without category filter...`);
              vegetableCandidates = await this.foodVectorService.searchFoodsByVector(
                vegetableEmbedding,
                {
                  mealTime: context.mealTime.code,
                  maxCalories: maxCalories * 2,
                },
                excludedIds,
                20
              );
              
              // Filter manually để lấy rau/củ
              if (vegetableCandidates) {
                vegetableCandidates = vegetableCandidates.filter((food: Food) => {
                  const category = (food.category || '').toLowerCase();
                  const foodName = (food.foodNameVi || food.foodName || '').toLowerCase();
                  return category === 'vegetable' || 
                         category === 'rau' ||
                         foodName.includes('rau') ||
                         foodName.includes('salad') ||
                         foodName.includes('bông cải') ||
                         foodName.includes('cải') ||
                         foodName.includes('xà lách') ||
                         foodName.includes('khoai') ||
                         foodName.includes('củ');
                });
              }
              
              // ✅ Cách 3: Nếu vẫn không có, search không có mealTime filter (rau có thể dùng cho nhiều bữa)
              if (!vegetableCandidates || vegetableCandidates.length === 0) {
                logger.warn(`No vegetables found with mealTime filter, trying without mealTime filter...`);
                vegetableCandidates = await this.foodVectorService.searchFoodsByVector(
                  vegetableEmbedding,
                  {
                    maxCalories: maxCalories * 2,
                    category: 'vegetable'
                  },
                  excludedIds,
                  20
                );
                
                // Nếu vẫn không có, thử không có cả category filter
                if (!vegetableCandidates || vegetableCandidates.length === 0) {
                  vegetableCandidates = await this.foodVectorService.searchFoodsByVector(
                    vegetableEmbedding,
                    {
                      maxCalories: maxCalories * 2,
                    },
                    excludedIds,
                    30
                  );
                  
                  // Filter manually để lấy rau/củ
                  if (vegetableCandidates) {
                    vegetableCandidates = vegetableCandidates.filter((food: Food) => {
                      const category = (food.category || '').toLowerCase();
                      const foodName = (food.foodNameVi || food.foodName || '').toLowerCase();
                      return category === 'vegetable' || 
                             category === 'rau' ||
                             foodName.includes('rau') ||
                             foodName.includes('salad') ||
                             foodName.includes('bông cải') ||
                             foodName.includes('cải') ||
                             foodName.includes('xà lách') ||
                             foodName.includes('khoai') ||
                             foodName.includes('củ');
                    });
                  }
                }
              }
            }
            
            if (vegetableCandidates && vegetableCandidates.length > 0) {
              logger.info(`✅ Found ${vegetableCandidates.length} vegetable candidates`);
              // Score và add vào vegetableNuts
              const scoredVegetables = vegetableCandidates.map((food: Food) => {
                const score = this.calculateFoodScore(food, context);
                return {
                  ...food,
                  score,
                  reason: `Phù hợp cho ${context.mealTime.nameVi} (rau)`,
                  servingSuggestion: this.calculateServingSuggestion(food, context.targetCalories),
                  targetCalories: maxCalories,
                };
              }).sort((a, b) => b.score - a.score);
              
              vegetableNuts.push(...scoredVegetables.slice(0, 2));
            } else {
              logger.warn(`⚠️ No vegetables found even without category filter`);
            }
            
            // ✅ Search riêng cho hạt/sữa nếu chưa đủ
            if (vegetableNuts.length < 2) {
              const nutQuery = `Hạt dinh dưỡng và sữa cho bữa ${context.mealTime.nameVi}, giàu chất béo tốt, protein`;
              const nutEmbedding = await this.pgVectorService.embed(nutQuery);
              
              let nutCandidates = await this.foodVectorService.searchFoodsByVector(
                nutEmbedding,
                {
                  mealTime: context.mealTime.code,
                  maxCalories: maxCalories * 2,
                },
                excludedIds,
                20
              );
              
              // ✅ Nếu không có với mealTime filter, thử không có mealTime
              if (!nutCandidates || nutCandidates.length === 0) {
                nutCandidates = await this.foodVectorService.searchFoodsByVector(
                  nutEmbedding,
                  {
                    maxCalories: maxCalories * 2,
                  },
                  excludedIds,
                  20
                );
              }
              
              if (nutCandidates && nutCandidates.length > 0) {
                // Filter manually để lấy hạt/sữa
                nutCandidates = nutCandidates.filter((food: Food) => this.isVegetableOrNut(food) && 
                  !vegetableNuts.some(v => this.getFoodId(v) === this.getFoodId(food)));
                
                if (nutCandidates.length > 0) {
                  logger.info(`✅ Found ${nutCandidates.length} nut/dairy candidates`);
                  const scoredNuts = nutCandidates.map((food: Food) => {
                    const score = this.calculateFoodScore(food, context);
                    const foodName = (food.foodNameVi || food.foodName || '').toLowerCase();
                    const isDairy = foodName.includes('sữa') || foodName.includes('yogurt') || foodName.includes('sữa chua');
                    return {
                      ...food,
                      score,
                      reason: `Phù hợp cho ${context.mealTime.nameVi} (${isDairy ? 'sữa' : 'hạt'})`,
                      servingSuggestion: this.calculateServingSuggestion(food, context.targetCalories),
                      targetCalories: maxCalories,
                    };
                  })
                  .sort((a, b) => b.score - a.score);
                  
                  vegetableNuts.push(...scoredNuts.slice(0, 2 - vegetableNuts.length));
                }
              }
            }
            
            logger.info(`✅ Total vegetables/nuts found: ${vegetableNuts.length}`);
          } catch (error) {
            logger.error('Error searching for vegetables/nuts separately:', error);
          }
        }
        
        // Nếu tìm được rau/hạt/củ/sữa, thay thế vào meal
        if (vegetableNuts.length > 0) {
          // Thay thế 1-2 món có score thấp nhất bằng rau/hạt/củ/sữa
          const replaceCount = Math.min(vegetableNuts.length, 2);
          const finalRecommendations = topRecommendations
            .slice(0, NUTRITION_CONSTANTS.MAX_RECOMMENDATIONS - replaceCount);
          
          // Add rau/hạt/củ/sữa vào
          vegetableNuts.slice(0, replaceCount).forEach(veg => {
            const foodName = (veg.foodNameVi || veg.foodName || '').toLowerCase();
            let typeLabel = 'rau/hạt';
            if (foodName.includes('khoai') || foodName.includes('củ')) {
              typeLabel = 'củ';
            } else if (foodName.includes('sữa') || foodName.includes('yogurt')) {
              typeLabel = 'sữa';
            } else if (foodName.includes('hạt') || foodName.includes('hạnh nhân') || foodName.includes('đậu phộng')) {
              typeLabel = 'hạt';
            } else {
              typeLabel = 'rau';
            }
            
            finalRecommendations.push({
              ...veg,
              reason: `Phù hợp cho ${context.mealTime.nameVi} (${typeLabel})`,
              servingSuggestion: this.calculateServingSuggestion(veg, context.targetCalories),
              targetCalories: maxCalories,
            });
          });
          
          return finalRecommendations
            .sort((a, b) => b.score - a.score)
            .slice(0, NUTRITION_CONSTANTS.MAX_RECOMMENDATIONS);
        }
      } else {
        // Nếu đã có rau/hạt nhưng chỉ có 1, thử thêm 1 món nữa nếu có thể
        const vegetableCount = topRecommendations.filter(food => this.isVegetableOrNut(food)).length;
        if (vegetableCount === 1) {
          const additionalVegetables = sortedRecommendations
            .filter(food => 
              this.isVegetableOrNut(food) && 
              !topRecommendations.some(r => this.getFoodId(r) === this.getFoodId(food))
            )
            .slice(0, 1);
          
          if (additionalVegetables.length > 0) {
            const finalRecommendations = topRecommendations.slice(0, -1);
            finalRecommendations.push({
              ...additionalVegetables[0],
              reason: `Phù hợp cho ${context.mealTime.nameVi} (rau/hạt)`,
              servingSuggestion: this.calculateServingSuggestion(additionalVegetables[0], context.targetCalories),
              targetCalories: maxCalories,
            });
            
            return finalRecommendations
      .sort((a, b) => b.score - a.score)
              .slice(0, NUTRITION_CONSTANTS.MAX_RECOMMENDATIONS);
          }
        }
      }
    }

    return sortedRecommendations
      .slice(0, NUTRITION_CONSTANTS.MAX_RECOMMENDATIONS);
  }

  /**
   * ✅ NEW: Enforce category limits to avoid too many items of same type
   */
  private enforceCategoryLimits(recommendations: any[], context: MealContext): any[] {
    const categoryLimits: Record<string, number> = {
      protein: 3, // Max 3 protein items
      carbs: 2,   // Max 2 carbs items
      vegetables: 2, // Max 2 vegetables
      fruits: 1,   // Max 1 fruit
      dairy: 1,   // Max 1 dairy (tránh 2 sữa như breakfast)
      fats: 1,    // Max 1 fat
      other: 1    // Max 1 other
    };
    
    const categoryCount: Record<string, number> = {
      protein: 0,
      carbs: 0,
      vegetables: 0,
      fruits: 0,
      dairy: 0,
      fats: 0,
      other: 0
    };
    
    const result: any[] = [];
    const removed: any[] = [];
    
    // First pass: add items within limits
    for (const food of recommendations) {
      const category = this.getFoodCategory(food);
      const count = categoryCount[category] || 0;
      const limit = categoryLimits[category] || 1;
      
      if (count < limit) {
        result.push(food);
        categoryCount[category] = (categoryCount[category] || 0) + 1;
      } else {
        removed.push(food);
      }
    }
    
    // If we removed items, log it
    if (removed.length > 0) {
      logger.info(`⚠️ Removed ${removed.length} items due to category limits for ${context.mealTime.code}`);
      // Log what categories were removed
      const removedCategories = removed.map(f => this.getFoodCategory(f));
      const removedCounts: Record<string, number> = {};
      removedCategories.forEach(cat => {
        removedCounts[cat] = (removedCounts[cat] || 0) + 1;
      });
      logger.info(`📋 Removed categories: ${JSON.stringify(removedCounts)}`);
    }
    
    // ✅ FIXED: Fill remaining slots with removed items if needed, but RESPECT category limits
    if (result.length < NUTRITION_CONSTANTS.MAX_RECOMMENDATIONS && removed.length > 0) {
      const needed = NUTRITION_CONSTANTS.MAX_RECOMMENDATIONS - result.length;
      
      // Try to add items from different categories first, but still respect limits
      const addedCategories = new Set(result.map(f => this.getFoodCategory(f)));
      const varietyItems = removed.filter(f => {
        const cat = this.getFoodCategory(f);
        // Only add if category is not already at limit
        const currentCount = categoryCount[cat] || 0;
        const limit = categoryLimits[cat] || 1;
        return !addedCategories.has(cat) && currentCount < limit;
      });
      
      // Add variety items first (respecting limits)
      for (const item of varietyItems) {
        if (result.length >= NUTRITION_CONSTANTS.MAX_RECOMMENDATIONS) break;
        const cat = this.getFoodCategory(item);
        const currentCount = categoryCount[cat] || 0;
        const limit = categoryLimits[cat] || 1;
        if (currentCount < limit) {
          result.push(item);
          categoryCount[cat] = (categoryCount[cat] || 0) + 1;
        }
      }
      
      // Then try other items (still respecting limits)
      const otherItems = removed.filter(f => {
        const cat = this.getFoodCategory(f);
        const currentCount = categoryCount[cat] || 0;
        const limit = categoryLimits[cat] || 1;
        return currentCount < limit;
      });
      
      for (const item of otherItems) {
        if (result.length >= NUTRITION_CONSTANTS.MAX_RECOMMENDATIONS) break;
        const cat = this.getFoodCategory(item);
        const currentCount = categoryCount[cat] || 0;
        const limit = categoryLimits[cat] || 1;
        if (currentCount < limit) {
          result.push(item);
          categoryCount[cat] = (categoryCount[cat] || 0) + 1;
        }
      }
      
      const added = result.length - (NUTRITION_CONSTANTS.MAX_RECOMMENDATIONS - needed);
      if (added > 0) {
        logger.info(`✅ Filled ${added} slots from removed items (respecting category limits)`);
      }
    }
    
    return result;
  }

  /**
   * ✅ NEW: Get normalized food id
   */
  private getFoodId(food: any): string | undefined {
    if (!food) return undefined;
    return food.id || food.foodId || food.food_id;
  }

  /**
   * ✅ NEW: Get food category
   * ✅ FIXED: Check food name FIRST for dairy items (sữa) before checking category
   * ✅ IMPROVED: Handle both singular/plural and normalize database categories
   * This ensures "Sữa đậu nành" with category="protein" is correctly classified as dairy
   */
  private getFoodCategory(food: any): string {
    const category = (food.category || '').toLowerCase().trim();
    const foodName = (food.foodNameVi || food.foodName || '').toLowerCase();
    
    // ✅ Normalize database category (handle singular/plural & Vietnamese variants)
    const normalizedCategory = this.normalizeCategory(category);

    switch (normalizedCategory) {
      case 'dairy':
      case 'protein':
      case 'carbs':
      case 'vegetables':
      case 'fruits':
      case 'fats':
        return normalizedCategory;
    }

    // ✅ Fallback to name-based heuristics when category is missing/other
    if (foodName.includes('sữa') || foodName.includes('yogurt') ||
        foodName.includes('sữa chua') || foodName.includes('milk') || foodName.includes('cheese')) {
      return 'dairy';
    }

    if (foodName.includes('thịt') || foodName.includes('cá') || 
        foodName.includes('tôm') || foodName.includes('trứng') || foodName.includes('chicken') ||
        foodName.includes('beef') || foodName.includes('fish') || foodName.includes('shrimp')) {
      return 'protein';
    }

    if (foodName.includes('cơm') || foodName.includes('bánh mì') ||
        foodName.includes('khoai') || foodName.includes('rice') || foodName.includes('bread') ||
        foodName.includes('pasta') || foodName.includes('noodle') || foodName.includes('gạo') ||
        foodName.includes('bún') || foodName.includes('phở') || foodName.includes('miến') ||
        foodName.includes('tinh bột')) {
      return 'carbs';
    }

    if (foodName.includes('rau') || foodName.includes('salad') ||
        foodName.includes('bông cải') || foodName.includes('cải') ||
        foodName.includes('xà lách') || foodName.includes('cà chua') || foodName.includes('dưa chuột') ||
        foodName.includes('cà rốt') || foodName.includes('bắp cải') || foodName.includes('cải bó xôi')) {
      return 'vegetables';
    }

    if (foodName.includes('trái cây') || foodName.includes('chuối') || foodName.includes('táo') ||
        foodName.includes('cam') || foodName.includes('banana') || foodName.includes('apple') ||
        foodName.includes('orange') || foodName.includes('dâu')) {
      return 'fruits';
    }

    if (foodName.includes('hạt') || foodName.includes('đậu phộng') || foodName.includes('hạnh nhân') ||
        foodName.includes('óc chó') || foodName.includes('bơ') || foodName.includes('dầu') ||
        foodName.includes('nut') || foodName.includes('avocado')) {
      return 'fats';
    }

    return 'other';
  }

  /**
   * ✅ NEW: Normalize category from database (handle singular/plural)
   */
  private normalizeCategory(category: string): string {
    if (!category) return '';
    
    const cat = category.toLowerCase().trim();

    // Map common variations to standard form
    if (['carb', 'carbs', 'carbohydrate', 'carbohydrates', 'tinh bột'].includes(cat)) return 'carbs';
    if (['vegetable', 'vegetables', 'rau', 'rau củ', 'rau quả'].includes(cat)) return 'vegetables';
    if (['fruit', 'fruits', 'trái cây', 'hoa quả'].includes(cat)) return 'fruits';
    if (['fat', 'fats', 'chất béo'].includes(cat)) return 'fats';
    if (['dairy', 'sữa'].includes(cat)) return 'dairy';
    if (['protein', 'đạm'].includes(cat)) return 'protein';

    return cat; // Return as-is for unknown categories
  }

  /**
   * ✅ NEW: Count categories in recommendations
   * ✅ FIXED: Use getFoodCategory for consistency
   */
  private countCategories(recommendations: any[]): Record<string, number> {
    const counts: Record<string, number> = {
      protein: 0,
      carbs: 0,
      vegetables: 0,
      fruits: 0,
      dairy: 0,
      fats: 0,
      other: 0
    };
    
    recommendations.forEach(food => {
      const category = this.getFoodCategory(food);
      counts[category] = (counts[category] || 0) + 1;
    });
    
    return counts;
  }

  /**
   * ✅ NEW: Search for missing categories
   */
  private async searchMissingCategories(
    missingCategories: string[],
    context: MealContext,
    excludedIds: string[],
    maxCalories: number,
    existingRecommendations: any[]
  ): Promise<any[]> {
    const additionalFoods: any[] = [];
    
    for (const category of missingCategories) {
      try {
        let searchQuery = '';
        let categoryFilter: string | undefined = undefined;
        
        switch (category) {
          case 'protein':
            searchQuery = `Thịt, cá, trứng cho bữa ${context.mealTime.nameVi}, giàu protein`;
            categoryFilter = 'protein';
            break;
          case 'carbs':
            // Try multiple queries for better results
            searchQuery = `Cơm gạo lứt, bánh mì, khoai lang, khoai tây cho bữa ${context.mealTime.nameVi}, nguồn năng lượng, tinh bột`;
            // ✅ Try both 'carbs' and 'carb' in database
            categoryFilter = 'carbs'; // Will try 'carb' as fallback if needed
            break;
          case 'vegetables':
            // Try multiple queries for better results
            searchQuery = `Rau xanh, salad, bông cải xanh, cải bó xôi, xà lách cho bữa ${context.mealTime.nameVi}, nhiều chất xơ, vitamin, ít calo`;
            // ✅ Try both 'vegetable' and 'vegetables' in database
            categoryFilter = 'vegetable'; // Will try 'vegetables' as fallback if needed
            break;
          case 'fruits':
            searchQuery = `Trái cây cho bữa ${context.mealTime.nameVi}, vitamin, chất xơ`;
            categoryFilter = 'fruit';
            break;
          case 'dairy':
            searchQuery = `Sữa, sữa chua cho bữa ${context.mealTime.nameVi}, canxi, protein`;
            categoryFilter = 'dairy';
            break;
          case 'fats':
            searchQuery = `Hạt, dầu tốt cho bữa ${context.mealTime.nameVi}, chất béo tốt`;
            // No specific category filter for fats
            break;
        }
        
        if (!searchQuery) continue;
        
        const queryEmbedding = await this.pgVectorService.embed(searchQuery);
        
        const filters: any = {
          mealTime: context.mealTime.code,
          maxCalories: maxCalories * 2,
        };
        if (categoryFilter) {
          filters.category = categoryFilter;
        }
        
        let candidates = await this.foodVectorService.searchFoodsByVector(
          queryEmbedding,
          filters,
          excludedIds,
          10
        );
        
        // Fallback: try without mealTime filter
        if (!candidates || candidates.length === 0) {
          delete filters.mealTime;
          candidates = await this.foodVectorService.searchFoodsByVector(
            queryEmbedding,
            filters,
            excludedIds,
            15
          );
        }
        
        // Fallback 2: try without category filter (for vegetables and carbs)
        if ((!candidates || candidates.length === 0) && (category === 'vegetables' || category === 'carbs')) {
          logger.info(`⚠️ No ${category} found with category filter, trying without category filter...`);
          delete filters.category;
          candidates = await this.foodVectorService.searchFoodsByVector(
            queryEmbedding,
            filters,
            excludedIds,
            20
          );
          logger.info(`🔍 Found ${candidates?.length || 0} candidates without category filter`);
        }
        
        // ✅ IMPROVED: Filter to ensure correct category using getFoodCategory for consistency
        if (candidates && candidates.length > 0) {
          // ✅ DEBUG: Log first few candidates to see what we're getting
          const sampleCandidates = candidates.slice(0, 3).map((f: Food) => ({
            name: f.foodNameVi || f.foodName,
            category: f.category,
            detected: this.getFoodCategory(f)
          }));
          logger.info(`🔍 Sample candidates for ${category}: ${JSON.stringify(sampleCandidates)}`);
          
          const filtered = candidates.filter((food: Food) => {
            // Check if already in existing recommendations
            const candidateId = this.getFoodId(food);
            if (candidateId && existingRecommendations.some(r => this.getFoodId(r) === candidateId)) {
              return false;
            }
            
            // ✅ Use getFoodCategory for consistent category detection
            const detectedCategory = this.getFoodCategory(food);
            const matches = detectedCategory === category;
            
            if (!matches && candidates.indexOf(food) < 5) {
              // Log first 5 mismatches for debugging
              logger.info(`❌ Mismatch: "${food.foodNameVi || food.foodName}" (db_category: ${food.category}, detected: ${detectedCategory}, looking for: ${category})`);
            }
            
            return matches;
          });
          
          logger.info(`📊 Filtered ${filtered.length} ${category} items from ${candidates.length} candidates`);
          
          if (filtered.length > 0) {
            // Score and add best one
            const scored = filtered.map((food: Food) => {
              const score = this.calculateFoodScore(food, context);
              return {
                ...food,
                score,
                reason: `Phù hợp cho ${context.mealTime.nameVi} (${category})`,
                servingSuggestion: this.calculateServingSuggestion(food, context.targetCalories),
                targetCalories: maxCalories,
              };
            }).sort((a, b) => b.score - a.score);
            
            additionalFoods.push(scored[0]);
            logger.info(`✅ Found ${category} candidate: ${scored[0].foodNameVi || scored[0].foodName}`);
          } else {
            logger.warn(`⚠️ No ${category} found after filtering (had ${candidates?.length || 0} candidates)`);
          }
        } else {
          logger.warn(`⚠️ No ${category} candidates found from vector search`);
        }
      } catch (error) {
        logger.error(`❌ Error searching for ${category}:`, error);
      }
    }
    
    logger.info(`📦 Total additional foods found: ${additionalFoods.length} for categories: ${missingCategories.join(', ')}`);
    return additionalFoods;
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
    // ✅ NEW: Bonus cho rau và hạt cho bữa trưa và tối
    const vegetableNutBonus = this.calculateVegetableNutBonus(food, context);

    return similarityScore + nutritionBonus + goalBonus + vegetableNutBonus;
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
   * ✅ NEW: Check if food is vegetable, nut, root vegetable, or dairy (for meal variety)
   */
  private isVegetableOrNut(food: Food): boolean {
    const category = (food.category || '').toLowerCase();
    const foodName = (food.foodNameVi || food.foodName || '').toLowerCase();
    
    // Check if food is vegetable
    const isVegetable = 
      category === 'vegetable' || 
      category === 'rau' ||
      foodName.includes('rau') ||
      foodName.includes('salad') ||
      foodName.includes('bông cải') ||
      foodName.includes('cải') ||
      foodName.includes('xà lách') ||
      foodName.includes('cà rốt') ||
      foodName.includes('cà chua') ||
      foodName.includes('dưa chuột');

    // Check if food is nut/seed
    const isNut = 
      category === 'nut' ||
      category === 'seed' ||
      category === 'hạt' ||
      foodName.includes('hạt') ||
      foodName.includes('nut') ||
      foodName.includes('đậu phộng') ||
      foodName.includes('hạnh nhân') ||
      foodName.includes('óc chó') ||
      foodName.includes('hạt điều') ||
      foodName.includes('hạt chia') ||
      foodName.includes('hạt lanh');

    // ✅ NEW: Check if food is root vegetable/củ
    const isRootVegetable = 
      foodName.includes('khoai') ||
      foodName.includes('củ') ||
      foodName.includes('cà rốt') ||
      foodName.includes('khoai lang') ||
      foodName.includes('khoai tây') ||
      foodName.includes('củ cải');

    // ✅ NEW: Check if food is dairy (for variety)
    const isDairy = 
      category === 'dairy' ||
      foodName.includes('sữa') ||
      foodName.includes('yogurt') ||
      foodName.includes('sữa chua');

    return isVegetable || isNut || isRootVegetable || isDairy;
  }

  /**
   * ✅ NEW: Calculate bonus for vegetables, nuts, root vegetables, and dairy for lunch and dinner
   */
  private calculateVegetableNutBonus(food: Food, context: MealContext): number {
    // Chỉ áp dụng cho bữa trưa và tối
    if (context.mealTime.code !== 'lunch' && context.mealTime.code !== 'dinner') {
      return 0;
    }

    if (!this.isVegetableOrNut(food)) {
      return 0;
    }

    const category = (food.category || '').toLowerCase();
    const foodName = (food.foodNameVi || food.foodName || '').toLowerCase();
    
    // Check if food is vegetable
    const isVegetable = 
      category === 'vegetable' || 
      category === 'rau' ||
      foodName.includes('rau') ||
      foodName.includes('salad') ||
      foodName.includes('bông cải') ||
      foodName.includes('cải') ||
      foodName.includes('xà lách') ||
      foodName.includes('cà rốt') ||
      foodName.includes('cà chua') ||
      foodName.includes('dưa chuột');

    // Check if food is root vegetable/củ
    const isRootVegetable = 
      foodName.includes('khoai') ||
      foodName.includes('củ') ||
      foodName.includes('khoai lang') ||
      foodName.includes('khoai tây') ||
      foodName.includes('củ cải');

    // Check if food is nut/seed
    const isNut = 
      category === 'nut' ||
      category === 'seed' ||
      category === 'hạt' ||
      foodName.includes('hạt') ||
      foodName.includes('nut') ||
      foodName.includes('đậu phộng') ||
      foodName.includes('hạnh nhân') ||
      foodName.includes('óc chó') ||
      foodName.includes('hạt điều') ||
      foodName.includes('hạt chia') ||
      foodName.includes('hạt lanh');

    // Check if food is dairy
    const isDairy = 
      category === 'dairy' ||
      foodName.includes('sữa') ||
      foodName.includes('yogurt') ||
      foodName.includes('sữa chua');

    if (isVegetable) {
      // ✅ Bonus cao cho rau trong bữa trưa và tối
      return 30;
    }
    
    if (isRootVegetable) {
      // ✅ Bonus cho củ (khoai lang, khoai tây, etc.)
      return 25;
    }
    
    if (isNut) {
      // Bonus cho hạt
      return 20;
    }
    
    if (isDairy) {
      // ✅ Bonus cho sữa (để có variety)
      return 15;
    }
    
    return 0;
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
    
    // ✅ NEW: Thêm yêu cầu về rau và hạt cho bữa trưa và tối
    if (mealTime.code === 'lunch' || mealTime.code === 'dinner') {
      query += ` Bữa ${mealTime.nameVi} nên bao gồm rau xanh và có thể thêm các loại hạt để tăng chất xơ, vitamin và chất béo tốt.`;
    }

    return query;
  }
}
