import { Equipment } from "./equipment.model";
import { ExerciseCategory } from "./exerciseCategory.model";
import { Muscle } from "./muscle.model";

export interface Exercise {
  id: string;
  slug: string;
  name: string;
  primaryMuscle: Muscle;
  secondaryMuscles: Muscle[];
  equipment: Equipment;
  bodyPart: string;
  exerciseCategory: ExerciseCategory;
  difficultyLevel: number; // or 1-5
  instructions?: string[];
  safetyNotes?: string;
  thumbnailUrl?: string;
  benefits?: string;
  tags?: string[];
  alternativeNames?: string[];

  // description: string;
  // exerciseType: string;
}
