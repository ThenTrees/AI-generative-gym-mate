import { Objective } from "../../common/common-enum";
export interface Goal {
  id: string;
  objectiveType: Objective;
  sessionsPerWeek: number;
  sessionMinutes: number;
  preferences?: string;
  // description: string;
  // estimatedCaloriesPerSession: number;
  // healthSafetyNotes: string;
}
