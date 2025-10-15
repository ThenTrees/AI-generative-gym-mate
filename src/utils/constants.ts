export const WORKOUT_CONSTANTS = {
  BASE_INTENSITY: 5,
  BASE_REPS: 10,
  BASE_SETS: 3,
  MAX_SESSIONS_PER_WEEK: 7,
  MIN_SESSION_MINUTES: 15,
  MAX_SESSION_MINUTES: 180,
  // Suggested weeks based on fitness level and objectives
  SUGGESTED_WEEKS: {
    BEGINNER: {
      LOSE_FAT: 6,
      GAIN_MUSCLE: 8,
      ENDURANCE: 6,
      MAINTAIN: 4,
    },
    INTERMEDIATE: {
      LOSE_FAT: 8,
      GAIN_MUSCLE: 10,
      ENDURANCE: 8,
      MAINTAIN: 6,
    },
    ADVANCED: {
      LOSE_FAT: 10,
      GAIN_MUSCLE: 12,
      ENDURANCE: 10,
      MAINTAIN: 8,
    },
  },
} as const;
