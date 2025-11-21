import { Exercise } from "./exercise.model";
import { Prescription } from "./prescription";

export interface PlanItem {
  exercise: Exercise;
  itemIndex: number;
  prescription: Prescription; // "3 sets x 12 reps" hoặc "30 seconds"
  notes?: string;
  // similarityScore?: number;
}
