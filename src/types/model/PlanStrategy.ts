import { HealthConsideration } from "./HealthConsideration";
import { IntensityLevel } from "./IntensityLevel";
import { SessionStructure } from "./SessionStructure";
import { VolumeTargets } from "./VolumeTargets";

export interface PlanStrategy {
  primaryObjective: string;
  experienceLevel: string;
  sessionStructure: SessionStructure;
  equipmentPreferences: string[];
  specialConsiderations: HealthConsideration[];
  intensityLevel: IntensityLevel;
  volumeTargets: VolumeTargets;
}
