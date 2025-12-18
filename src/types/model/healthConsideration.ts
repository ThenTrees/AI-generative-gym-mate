export interface HealthConsideration {
  type: "joint_limitation" | "injury_history" | "mobility_issue";
  affectedArea: string;
  restrictions: string[];
  modifications: string[];
}
