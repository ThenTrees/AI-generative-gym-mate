import { WeeklyProgression } from "./progressiveOverload";

export interface WorkoutSplit {
  name: string;
  focus: string;
  movementPatterns: string[];
  primaryMuscles: string[];
  exerciseCount: number;
  intensityLevel: number;
  weeklyProgression?: WeeklyProgression;
  phase?: string;
  isDeloadWeek?: boolean;
}
