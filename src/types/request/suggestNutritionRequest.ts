import { DayType } from "../../common/common-enum";
import { Goal } from "../model/goal.model";
import { UserProfile } from "../model/userProfile.model";

export interface SuggestNutritionRequest {
  userProfile: UserProfile;
  dayType: DayType;
  goal: Goal;
  muscles?: string[];
  // preferences?: { cuisine?: string; exclude?: string[]; mealsPerDay?: number };
}
