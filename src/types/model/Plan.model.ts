import { PlanDay } from "./planDay.model";

export interface Plan {
  id: string;
  userId: string;
  goalId?: string;
  title: string;
  description?: string;
  planDays: PlanDay[];
  totalWeeks: number;
  totalDays: number;
  createdAt: string;
  endDate: string;
  aiMetadata?: Record<string, any>;
  generationParams?: Record<string, any>;
}
