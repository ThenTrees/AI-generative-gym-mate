import { Goal } from "../model/goal.model";
import { UserProfile } from "../model/userProfile.model";

export interface PlanRequest {
  userProfile: UserProfile;
  goal: Goal;
  userId: string;
  goalId?: string;
}
