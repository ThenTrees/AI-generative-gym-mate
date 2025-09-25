import { Intensity } from "../../common/common-enum";

export interface Prescription {
  sets: number;
  reps?: number;
  weight?: number; // kg
  restTime: number; // seconds
  duration?: number;
  intensity?: Intensity;
}
