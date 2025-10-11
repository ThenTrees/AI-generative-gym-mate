import { Objective } from "../common/common-enum";

/**
 * Constants for nutrition calculations and meal planning
 */
export const NUTRITION_CONSTANTS = {
  // Scoring weights
  SIMILARITY_WEIGHT: 70,
  PROTEIN_BONUS: 15,
  CARBS_BONUS: 10,
  GOAL_BONUS: {
    [Objective.GAIN_MUSCLE]: 25,
    [Objective.LOSE_FAT]: 20,
    [Objective.ENDURANCE]: 20,
    [Objective.MAINTAIN]: 0,
  },
  GOAL_BONUS_FALLBACK: 10,

  // Serving calculations
  MIN_SERVING_GRAMS: 50,
  MAX_SERVING_GRAMS: 400,
  SERVING_ROUND_TO: 10,

  // Calorie distribution
  MAX_CALORIE_RATIO: 0.6, // Max 60% of target calories per food item

  // Search limits
  DEFAULT_SEARCH_LIMIT: 30,
  MAX_RECOMMENDATIONS: 5,

  // Macro ratios by objective
  MACRO_RATIOS: {
    [Objective.GAIN_MUSCLE]: {
      protein: 0.3,
      fat: 0.25,
      carbs: 0.45,
    },
    [Objective.LOSE_FAT]: {
      protein: 0.35,
      fat: 0.3,
      carbs: 0.35,
    },
    [Objective.ENDURANCE]: {
      protein: 0.2,
      fat: 0.2,
      carbs: 0.6,
    },
    [Objective.MAINTAIN]: {
      protein: 0.25,
      fat: 0.25,
      carbs: 0.5,
    },
  },

  // Calorie adjustments by objective
  CALORIE_ADJUSTMENTS: {
    [Objective.GAIN_MUSCLE]: {
      trainingDay: 250,
      restDay: 200,
    },
    [Objective.LOSE_FAT]: {
      trainingDay: 0.5, // 50% of workout calories
      restDay: -400,
    },
    [Objective.ENDURANCE]: {
      trainingDay: 0.75, // 75% of workout calories
      restDay: 0,
    },
    [Objective.MAINTAIN]: {
      trainingDay: 1, // 100% of workout calories
      restDay: 0,
    },
  },

  // TDEE multipliers by activity level
  TDEE_MULTIPLIERS: {
    LOW: 1.375, // 1-3 sessions/week
    MODERATE: 1.55, // 4-5 sessions/week
    HIGH: 1.725, // 6+ sessions/week
  },
} as const;

/**
 * Thresholds for nutrition bonuses
 */
export const NUTRITION_THRESHOLDS = {
  HIGH_PROTEIN: 20,
  HIGH_CARBS: 20,
  LOW_CALORIES: 150,
  PROTEIN_BONUS_THRESHOLD: 15,
  CARBS_BONUS_THRESHOLD: 20,
} as const;
