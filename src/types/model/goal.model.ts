import { Objective } from "../../common/common-enum";
import { UserProfile } from "./userProfile.model";

export interface Goal {
  // id: number;
  // userProfile: UserProfile;
  objectiveType: Objective;
  sessionsPerWeek: number;
  sessionMinutes: number;
  preferences?: string;
  // description: string;
  // estimatedCaloriesPerSession: number;
  // healthSafetyNotes: string;
}
