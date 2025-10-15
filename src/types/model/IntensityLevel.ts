import { RestPeriods } from "./RestPeriods";

export interface IntensityLevel {
  level: number; // 1-10
  rpeTarget: number; // 1-10 RPE scale
  restPeriods: RestPeriods;
}
