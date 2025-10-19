import { Intensity } from "../../common/common-enum";

export interface Prescription {
  sets: number;
  reps?: number;
  weight?: number; // kg
  restTime: number; // seconds
  duration?: number;
  intensity?: Intensity;
  rpe?: number; // Rate of Perceived Exertion (1-10)
  progressiveOverload?: {
    baseSets: number;
    baseReps?: number;
    baseWeight?: number;
    weeklyProgression: {
      setsIncrease: number;
      repsAdjustment: number;
      weightIncrease: number;
    };
  };
}
