import { Exercise } from "./exercise.model";

export interface ExerciseWithScore {
  exercise: Exercise;
  similarityScore: number;
  movementPattern: string;
  priority: number;
}
