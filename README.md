# Meal Plan Services Architecture

## Overview

The meal plan generation system has been refactored to improve maintainability, testability, and code organization. The complex logic has been broken down into focused, single-responsibility services.

## Service Structure

### 1. NutritionCalculationService

**Purpose**: Handles all nutrition-related calculations
**Responsibilities**:

- BMR (Basal Metabolic Rate) calculation using Mifflin-St Jeor equation
- TDEE (Total Daily Energy Expenditure) calculation
- Target calories calculation based on goals and training status
- Macronutrient distribution calculation
- Meal-specific nutrition calculations
- Total nutrition aggregation

**Key Methods**:

- `calculateBMR(profile)` - Calculate BMR from user profile
- `calculateTDEE(bmr, sessionsPerWeek)` - Calculate TDEE from BMR and activity level
- `calculateTargetCalories(tdee, objective, isTrainingDay, workoutCalories)` - Calculate daily calorie target
- `calculateMacros(calories, objective)` - Calculate protein/carbs/fat distribution
- `calculateNutritionTarget(profile, goal, isTrainingDay, workoutCalories)` - Complete nutrition target calculation
- `calculateMealNutrition(targetNutrition, caloriePercentage)` - Calculate nutrition for specific meal
- `calculateTotalNutrition(meals)` - Aggregate total nutrition from all meals

### 2. MealRecommendationService

**Purpose**: Handles food recommendations and scoring
**Responsibilities**:

- Generate meal recommendations using vector search
- Calculate food scores based on multiple factors
- Build contextual search queries
- Determine optimal serving sizes

**Key Methods**:

- `generateMealRecommendations(context)` - Main method to get food recommendations
- `calculateFoodScore(food, context)` - Calculate comprehensive food score
- `calculateNutritionBonus(food, context)` - Calculate nutrition-based bonus
- `calculateGoalBonus(food, objective)` - Calculate goal-based bonus
- `calculateServingSuggestion(food, targetCalories)` - Calculate optimal serving size
- `buildMealQuery(context)` - Build search query for vector search

### 3. MealPlanGenerator (Refactored)

**Purpose**: Orchestrates the meal plan generation process
**Responsibilities**:

- Coordinate between different services
- Handle database operations
- Manage meal plan persistence
- Provide the main API for meal plan generation

**Key Methods**:

- `generateDayMealPlan(userId, planDate, sessionId)` - Main entry point
- `getOrCalculateNutritionTarget()` - Get cached or calculate new nutrition targets
- `generateMealRecommendations()` - Delegate to MealRecommendationService
- Database operations (save, retrieve meal plans)

## Constants and Configuration

### nutritionConstants.ts

Contains all magic numbers and configuration values:

- Scoring weights and bonuses
- Serving size limits
- Macro ratios by objective
- Calorie adjustments by goal
- TDEE multipliers by activity level
- Nutrition thresholds

## Benefits of New Architecture

### 1. **Separation of Concerns**

- Each service has a single, clear responsibility
- Business logic is separated from database operations
- Calculation logic is isolated and testable

### 2. **Improved Testability**

- Services can be unit tested independently
- Mock dependencies easily
- Clear interfaces between components

### 3. **Better Maintainability**

- Smaller, focused methods
- Clear naming and documentation
- Constants instead of magic numbers

### 4. **Enhanced Reusability**

- Services can be used independently
- Easy to extend with new features
- Clear interfaces for integration

### 5. **Simplified Debugging**

- Easier to trace issues to specific services
- Clear data flow between components
- Better error isolation

## Usage Example

```typescript
// Initialize services
const nutritionService = new NutritionCalculationService();
const recommendationService = new MealRecommendationService();
const mealPlanGenerator = new MealPlanGenerator();

// Generate meal plan
const mealPlan = await mealPlanGenerator.generateDayMealPlan(
  userId,
  new Date(),
  sessionId
);
```

## Migration Notes

The refactored code maintains the same external API, so existing code using `MealPlanGenerator` will continue to work without changes. The internal implementation has been significantly improved for better maintainability and testability.
