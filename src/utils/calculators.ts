import { FitnessLevel, Gender, Objective } from "../common/common-enum";
import { Exercise } from "../types/model/exercise.model";

export class WorkoutCalculator {
  public calculateReps(
    objective: string,
    level: string,
    exercise: Exercise
  ): number {
    let baseReps: number;

    // Base reps by objective
    switch (objective) {
      case Objective.GAIN_MUSCLE:
        baseReps = 10;
        break;
      case Objective.LOSE_FAT:
        baseReps = 12;
        break;
      case Objective.ENDURANCE:
        baseReps = 20;
        break;
      default:
        baseReps = 12;
    }

    // Adjust for level
    if (level === FitnessLevel.BEGINNER) {
      baseReps += 2;
    } else if (level === FitnessLevel.ADVANCED) {
      if (objective === Objective.GAIN_MUSCLE) baseReps -= 2;
    }

    // Adjust for exercise type
    if (
      exercise.exerciseCategory.code === "strength" &&
      exercise.name.toLowerCase().includes("deadlift")
    ) {
      baseReps = Math.max(5, baseReps - 5); // Heavy compounds lower reps
    }

    if (exercise.bodyPart === "waist") {
      baseReps += 5; // Core exercises typically higher reps
    }

    return Math.max(5, Math.min(30, baseReps));
  }

  public calculateSets(
    objective: string,
    level: string,
    exercise: Exercise
  ): number {
    let baseSets: number;

    // Base sets by level
    switch (level) {
      case FitnessLevel.BEGINNER:
        baseSets = 2;
        break;
      case FitnessLevel.INTERMEDIATE:
        baseSets = 3;
        break;
      case FitnessLevel.ADVANCED:
        baseSets = 4;
        break;
      default:
        baseSets = 3;
    }

    // Adjust for objective
    if (objective === Objective.ENDURANCE) {
      baseSets = Math.max(3, baseSets);
    } else if (objective === Objective.GAIN_MUSCLE) {
      baseSets = Math.max(3, baseSets);
    }

    // Adjust for exercise complexity
    if (
      exercise.name.toLowerCase().includes("compound") ||
      ["squat", "deadlift", "bench", "row"].some((move) =>
        exercise.name.toLowerCase().includes(move)
      )
    ) {
      baseSets = Math.max(3, baseSets);
    }

    return Math.max(1, Math.min(6, baseSets));
  }

  /**
   * Calculate BMR using Mifflin-St Jeor equation
   */
  public calculateBMR(
    gender: Gender,
    weight: number,
    height: number,
    age: number
  ): number {
    if (gender === Gender.MALE) {
      return 10 * weight + 6.25 * height - 5 * age + 5;
    } else {
      return 10 * weight + 6.25 * height - 5 * age - 161;
    }
  }
  /**
   * Calculate TDEE
   */
  public calculateTDEE(bmr: number, sessionPerWeek: number): number {
    if (sessionPerWeek <= 3) {
      return bmr * 1.375;
    } else if (sessionPerWeek <= 5) {
      return bmr * 1.55;
    } else {
      return bmr * 1.725;
    }
  }

  /**
   * Calculate target calories based on goal
   */
  calculateTargetCalories(
    tdee: number,
    objective: Objective,
    isTrainingDay: boolean,
    workoutCalories: number = 0
  ): number {
    if (isTrainingDay) {
      switch (objective) {
        case Objective.GAIN_MUSCLE:
          return tdee + workoutCalories + 250;
        case Objective.LOSE_FAT:
          return tdee + workoutCalories * 0.5;
        case Objective.ENDURANCE:
          return tdee + workoutCalories * 0.75;
        case Objective.MAINTAIN:
          return tdee + workoutCalories;
      }
    } else {
      switch (objective) {
        case Objective.GAIN_MUSCLE:
          return tdee + 200;
        case Objective.LOSE_FAT:
          return tdee - 400;
        case Objective.ENDURANCE:
        case Objective.MAINTAIN:
          return tdee;
      }
    }
  }

  /**
   * Calculate macros based on goal
   */
  calculateMacros(calories: number, objective: Objective) {
    let proteinRatio: number, fatRatio: number, carbsRatio: number;

    switch (objective) {
      case Objective.GAIN_MUSCLE:
        proteinRatio = 0.3;
        fatRatio = 0.25;
        carbsRatio = 0.45;
        break;
      case Objective.LOSE_FAT:
        proteinRatio = 0.35;
        fatRatio = 0.3;
        carbsRatio = 0.35;
        break;
      case Objective.ENDURANCE:
        proteinRatio = 0.2;
        fatRatio = 0.2;
        carbsRatio = 0.6;
        break;
      case Objective.MAINTAIN:
        proteinRatio = 0.25;
        fatRatio = 0.25;
        carbsRatio = 0.5;
        break;
    }

    return {
      proteinG: Math.round((calories * proteinRatio) / 4),
      carbsG: Math.round((calories * carbsRatio) / 4),
      fatG: Math.round((calories * fatRatio) / 9),
    };
  }
}
