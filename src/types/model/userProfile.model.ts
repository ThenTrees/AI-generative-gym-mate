import { FitnessLevel, Gender } from "../../common/common-enum";

export interface UserProfile {
  age: number;
  gender: Gender; // MALE, FEMALE
  height: number; // cm
  weight: number; // kg
  bmi: number;
  fitnessLevel: FitnessLevel; // BEGINNER, INTERMEDIATE, ADVANCED
  healthNote?: string;
  // availableEquipment: string[];
}
