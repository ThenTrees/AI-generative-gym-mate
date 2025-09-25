import { PlanItem } from "./planItem.model";

export interface PlanDay {
  dayIndex: number;
  scheduledDate: string; // ISO date string
  planItems: PlanItem[];
  totalDuration: number;
  // focus: string; // e.g., "Upper Body", "Cardio", "Full Body"
  splitName: string; // split_name from plan_days
}
