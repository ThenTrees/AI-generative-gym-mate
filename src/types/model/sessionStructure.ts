export interface SessionStructure {
  type: "full_body" | "full_body_varied" | "upper_lower" | "body_part_split";
  exercisesPerSession: number; // số lượng bài tập của mỗi buổi
  splitStrategy: string;
}
