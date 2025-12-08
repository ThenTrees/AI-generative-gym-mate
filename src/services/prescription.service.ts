import { Exercise } from "../types/model/exercise.model";
import { UserProfile } from "../types/model/userProfile.model";
import { Goal } from "../types/model/goal.model";
import { WorkoutSplit } from "../types/model/workoutSplit";
import { Prescription } from "../types/model/prescription";
import { WorkoutCalculator } from "../utils/calculators";
import {
  FitnessLevel,
  Gender,
  Intensity,
  Objective,
} from "../common/common-enum";
import { WeeklyProgression } from "../types/model/progressiveOverload";

/**
 * Service responsible for generating exercise prescriptions
 */
export class PrescriptionService {
  constructor(private workoutCalculator: WorkoutCalculator) {}

  /**
   * Generate prescription for an exercise
   */
  generatePrescription(
    exercise: Exercise,
    userProfile: UserProfile,
    goal: Goal,
    split: WorkoutSplit
  ): Prescription {
    const baseReps = this.workoutCalculator.calculateReps(
      goal.objectiveType,
      userProfile.fitnessLevel,
      exercise
    );
    const baseSets = this.workoutCalculator.calculateSets(
      goal.objectiveType,
      userProfile.fitnessLevel,
      exercise
    );

    // Handle duration-based exercises
    const isDurationBased =
      exercise.name.toLowerCase().includes("plank") ||
      exercise.name.toLowerCase().includes("hold") ||
      exercise.exerciseCategory.code === "cardio";

    const baseWeight = this.calculateWeight(exercise, userProfile, goal);

    // Apply progressive overload if weekly progression is available
    let finalSets = baseSets;
    let finalReps = baseReps;
    let finalWeight = baseWeight;
    let rpe: number | undefined;

    if (split.weeklyProgression) {
      const progression = split.weeklyProgression;

      // Apply volume progression
      finalSets = Math.round(
        baseSets * progression.volumeModifier + progression.setsAdjustment
      );
      finalSets = Math.max(1, Math.min(8, finalSets)); // Keep within reasonable bounds

      if (!isDurationBased) {
        finalReps = Math.round(baseReps + progression.repsAdjustment);
        finalReps = Math.max(5, Math.min(30, finalReps)); // Keep within reasonable bounds
      }

      // Apply weight progression
      if (exercise.equipment.code !== "body_weight" && baseWeight > 0) {
        finalWeight = baseWeight + progression.weightIncrease;
        finalWeight = Math.max(2.5, finalWeight); // Minimum weight
      }

      // Calculate RPE based on progressive overload
      rpe = this.calculateRPEFromProgression(
        userProfile.fitnessLevel,
        goal.objectiveType,
        progression
      );
    }

    return {
      sets: finalSets,
      reps: isDurationBased ? undefined : finalReps,
      duration: isDurationBased
        ? this.calculateDuration(exercise, userProfile.fitnessLevel)
        : undefined,
      weight: finalWeight,
      restTime: this.calculateRestTime(
        exercise,
        goal.objectiveType,
        userProfile.fitnessLevel
      ),
      intensity: this.calculateIntensity(
        userProfile.fitnessLevel,
        goal.objectiveType,
        exercise
      ),
      rpe,
      progressiveOverload: split.weeklyProgression
        ? {
            baseSets,
            baseReps: isDurationBased ? undefined : baseReps,
            baseWeight,
            weeklyProgression: {
              setsIncrease: split.weeklyProgression.setsAdjustment,
              repsAdjustment: split.weeklyProgression.repsAdjustment,
              weightIncrease: split.weeklyProgression.weightIncrease,
            },
          }
        : undefined,
    };
  }

  /**
   * Calculate RPE from progression
   */
  private calculateRPEFromProgression(
    fitnessLevel: FitnessLevel,
    objective: Objective,
    progression: WeeklyProgression
  ): number {
    let baseRPE = 6; // Default moderate RPE

    // Adjust base RPE based on fitness level
    switch (fitnessLevel) {
      case FitnessLevel.BEGINNER:
        baseRPE = 6;
        break;
      case FitnessLevel.INTERMEDIATE:
        baseRPE = 7;
        break;
      case FitnessLevel.ADVANCED:
        baseRPE = 8;
        break;
    }

    // Adjust based on phase
    switch (progression.phase) {
      case "foundation":
        baseRPE -= 0.5;
        break;
      case "build":
        baseRPE += 0;
        break;
      case "peak":
        baseRPE += 1;
        break;
      case "deload":
        baseRPE -= 1.5;
        break;
    }

    // Adjust based on objective
    if (objective === Objective.ENDURANCE) {
      baseRPE -= 0.5; // Lower RPE for endurance
    } else if (objective === Objective.GAIN_MUSCLE) {
      baseRPE += 0.5; // Higher RPE for muscle gain
    }

    // Ensure RPE is within valid range (5-10)
    return Math.max(5, Math.min(10, Math.round(baseRPE * 10) / 10));
  }

  /**
   * Calculate duration for duration-based exercises
   */
  private calculateDuration(exercise: Exercise, level: FitnessLevel): number {
    const baseDurations = {
      BEGINNER: 30,
      INTERMEDIATE: 45,
      ADVANCED: 60,
    };

    let duration = baseDurations[level] || 45;

    // Exercise-specific adjustments
    if (exercise.name.toLowerCase().includes("plank")) {
      return duration;
    } else if (exercise.exerciseCategory.code === "cardio") {
      return duration * 8; // 4-8 minutes for cardio
    }

    return duration;
  }

  /**
   * Calculate suggested weight for exercise
   */
  private calculateWeight(
    exercise: Exercise,
    userProfile: UserProfile,
    goal: Goal
  ): number {
    if (exercise.equipment.code === "body_weight") {
      return 0;
    }

    const bodyweight = userProfile.weight;
    let levelMultiplier: number;

    switch (userProfile.fitnessLevel) {
      case FitnessLevel.BEGINNER:
        levelMultiplier = 0.4;
        break;
      case FitnessLevel.INTERMEDIATE:
        levelMultiplier = 0.6;
        break;
      case FitnessLevel.ADVANCED:
        levelMultiplier = 0.8;
        break;
      default:
        levelMultiplier = 0.5;
    }

    // Base percentage by body part/exercise type
    let basePercentage: number;
    switch (exercise.bodyPart) {
      case "chest":
        basePercentage = 0.6; // 60% bodyweight for chest
        break;
      case "upper_legs":
        basePercentage = 1.0; // 100% bodyweight for legs
        break;
      case "back":
        basePercentage = 0.7; // 70% bodyweight for back
        break;
      case "shoulders":
        basePercentage = 0.3; // 30% bodyweight for shoulders
        break;
      case "upper_arms":
        basePercentage = 0.25; // 25% bodyweight for arms
        break;
      default:
        basePercentage = 0.4;
    }

    // Gender adjustment
    if (userProfile.gender === Gender.FEMALE) {
      basePercentage *= 0.75;
    }

    // Goal adjustment
    if (goal.objectiveType === Objective.ENDURANCE) {
      basePercentage *= 0.7; // Lighter weights for endurance
    } else if (goal.objectiveType === Objective.GAIN_MUSCLE) {
      basePercentage *= 1.1; // Heavier for muscle gain
    }

    const suggestedWeight = bodyweight * basePercentage * levelMultiplier;

    // Round to nearest 2.5kg increment
    return Math.max(2.5, Math.round(suggestedWeight / 2.5) * 2.5);
  }

  /**
   * Calculate rest time between sets
   */
  private calculateRestTime(
    exercise: Exercise,
    objective: string,
    level: string
  ): number {
    let baseRest: number;

    // Base rest by exercise type
    if (
      exercise.name.toLowerCase().includes("squat") ||
      exercise.name.toLowerCase().includes("deadlift") ||
      exercise.bodyPart === "upper_legs"
    ) {
      baseRest = 180; // 3 minutes for heavy compounds
    } else if (exercise.bodyPart === "chest" || exercise.bodyPart === "back") {
      baseRest = 120; // 2 minutes for upper compounds
    } else if (
      exercise.bodyPart === "upper_arms" ||
      exercise.bodyPart === "waist"
    ) {
      baseRest = 60; // 1 minute for isolation
    } else {
      baseRest = 90; // Default 1.5 minutes
    }

    // Objective adjustments
    switch (objective) {
      case Objective.LOSE_FAT:
        baseRest *= 0.7; // Shorter rest for fat loss
        break;
      case Objective.ENDURANCE:
        baseRest *= 0.5; // Very short rest for endurance
        break;
      case Objective.GAIN_MUSCLE:
        baseRest *= 1.0; // Standard rest for hypertrophy
        break;
    }

    // Level adjustments
    if (level === FitnessLevel.BEGINNER) {
      baseRest *= 1.2; // Beginners need more rest
    } else if (level === FitnessLevel.ADVANCED) {
      baseRest *= 0.9; // Advanced can handle shorter rest
    }

    return Math.max(30, Math.min(300, Math.round(baseRest)));
  }

  /**
   * Calculate intensity level
   */
  private calculateIntensity(
    level: string,
    objective: string,
    exercise: Exercise
  ): Intensity {
    if (level === FitnessLevel.BEGINNER) {
      return Intensity.LOW;
    } else if (
      level === FitnessLevel.ADVANCED &&
      (objective === Objective.LOSE_FAT || objective === Objective.GAIN_MUSCLE)
    ) {
      return Intensity.HIGH;
    } else {
      return Intensity.MEDIUM;
    }
  }

  /**
   * Generate exercise notes for user
   */
  generateExerciseNote(exercise: Exercise, userProfile: UserProfile): string {
    const notes: string[] = [];

    // Level-based notes
    if (userProfile.fitnessLevel === FitnessLevel.BEGINNER) {
      notes.push("Focus on proper form and controlled movement");

      if (exercise.difficultyLevel >= 4) {
        notes.push("Start with lighter weight or assisted variation");
      }
    }

    // Health-based modifications
    if (userProfile.healthNote) {
      const healthNote = userProfile.healthNote.toLowerCase();

      if (healthNote.includes("knee")) {
        if (
          exercise.bodyPart === "upper_legs" ||
          exercise.name.toLowerCase().includes("squat")
        ) {
          notes.push("Modify range of motion if experiencing knee discomfort");
          notes.push("Consider partial squats or box squats");
        }
      }

      if (healthNote.includes("back")) {
        if (
          exercise.name.toLowerCase().includes("deadlift") ||
          exercise.name.toLowerCase().includes("row")
        ) {
          notes.push("Maintain neutral spine throughout the movement");
          notes.push("Engage core muscles for spinal stability");
        }
      }

      if (healthNote.includes("shoulder")) {
        if (
          exercise.bodyPart === "shoulders" ||
          exercise.name.toLowerCase().includes("press")
        ) {
          notes.push("Avoid overhead movements if experiencing shoulder pain");
          notes.push("Start with reduced range of motion");
        }
      }
    }

    // Exercise-specific safety notes
    if (exercise.safetyNotes) {
      notes.push(exercise.safetyNotes);
    }

    // General form cues based on exercise type
    if (exercise.name.toLowerCase().includes("plank")) {
      notes.push("Maintain straight line from head to heels");
    } else if (exercise.name.toLowerCase().includes("squat")) {
      notes.push("Keep chest up and knees tracking over toes");
    } else if (exercise.name.toLowerCase().includes("deadlift")) {
      notes.push("Hinge at hips, keep bar close to body");
    }

    return notes.length > 0 ? notes.join(". ") + "." : "";
  }
}
