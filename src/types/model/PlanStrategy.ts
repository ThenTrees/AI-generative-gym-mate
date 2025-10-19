import { HealthConsideration } from "./healthConsideration";
import { IntensityLevel } from "./intensityLevel";
import { SessionStructure } from "./sessionStructure";
import { VolumeTargets } from "./volumeTargets";

export interface PlanStrategy {
  primaryObjective: string;
  experienceLevel: string;
  sessionStructure: SessionStructure;
  equipmentPreferences: string[];
  specialConsiderations: HealthConsideration[];
  intensityLevel: IntensityLevel;
  volumeTargets: VolumeTargets;
}
