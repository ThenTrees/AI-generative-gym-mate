export interface Exercise {
  id: string;
  slug: string;
  name: string;
  primaryMuscle: string[];
  secondaryMuscles: string[];
  equipment: string;
  bodyPart: string;
  exerciseCategory: string;
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
