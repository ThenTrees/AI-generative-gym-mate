import { PlanDay } from "./planDay.model";

export interface Plan {
  id: string;
  userId: string;
  goalId?: string;
  title: string;
  description?: string;
  planDays: PlanDay[];
  totalWeeks: number; // tổng số tuần
  createdAt: string;
  endDate: string;
  aiMetadata?: Record<string, any>;
  generationParams?: Record<string, any>;
}
