import { Goal } from "../types/model/goal.model";
import { PlanStrategy } from "../types/model/planStrategy";
import { WorkoutSplit } from "../types/model/workoutSplit";
import {
  ProgressiveOverloadConfig,
  ProgressiveOverloadCalculator,
} from "../types/model/progressiveOverload";

/**
 * Service responsible for generating workout splits
 */
export class WorkoutSplitService {
  /**
   * Generate workout splits based on goal, strategy, and total weeks
   */
  generateWorkoutSplits(
    goal: Goal,
    strategy: PlanStrategy,
    totalWeeks: number
  ): WorkoutSplit[] {
    const splits: WorkoutSplit[] = [];

    switch (strategy.sessionStructure.type) {
      case "full_body":
        splits.push(
          ...this.generateFullBodySplits(
            goal.sessionsPerWeek,
            strategy,
            totalWeeks
          )
        );
        break;
      case "full_body_varied":
        splits.push(
          ...this.generateVariedFullBodySplits(
            goal.sessionsPerWeek,
            strategy,
            totalWeeks
          )
        );
        break;
      case "upper_lower":
        splits.push(
          ...this.generateUpperLowerSplits(
            goal.sessionsPerWeek,
            strategy,
            totalWeeks
          )
        );
        break;
      case "body_part_split":
        splits.push(
          ...this.generateBodyPartSplits(
            goal.sessionsPerWeek,
            strategy,
            totalWeeks
          )
        );
        break;
    }

    // Apply progressive overload to all splits
    return this.applyProgressiveOverloadToSplits(
      splits,
      strategy.progressiveOverloadConfig
    );
  }

  /**
   * Apply progressive overload to splits
   */
  private applyProgressiveOverloadToSplits(
    splits: WorkoutSplit[],
    progressiveConfig: ProgressiveOverloadConfig
  ): WorkoutSplit[] {
    return splits.map((split, index) => {
      const week = Math.floor(index / 7) + 1; // Assuming 7 sessions per week max
      const weeklyProgression =
        ProgressiveOverloadCalculator.calculateWeeklyProgression(
          progressiveConfig,
          week,
          Math.ceil(splits.length / 7) // Total weeks
        );

      return {
        ...split,
        weeklyProgression,
        phase: weeklyProgression.phase,
        isDeloadWeek: weeklyProgression.isDeloadWeek,
        intensityLevel: Math.round(
          split.intensityLevel * weeklyProgression.intensityModifier
        ),
      };
    });
  }

  /**
   * Generate full body splits
   */
  private generateFullBodySplits(
    sessionsPerWeek: number,
    strategy: PlanStrategy,
    totalWeeks: number
  ): WorkoutSplit[] {
    const splits: WorkoutSplit[] = [];

    for (let i = 0; i < sessionsPerWeek * totalWeeks; i++) {
      splits.push({
        name: `Full Body ${i + 1}`,
        focus: "full_body",
        movementPatterns: [
          "squat",
          "hinge",
          "push_horizontal",
          "pull_horizontal",
          "core",
        ],
        primaryMuscles: [
          "quadriceps",
          "hamstrings",
          "pectorals",
          "latissimus_dorsi",
          "deltoids",
        ],
        exerciseCount: strategy.sessionStructure.exercisesPerSession,
        intensityLevel: strategy.intensityLevel.level,
      });
    }

    return splits;
  }

  /**
   * Generate varied full body splits
   */
  private generateVariedFullBodySplits(
    sessionsPerWeek: number,
    strategy: PlanStrategy,
    totalWeeks: number
  ): WorkoutSplit[] {
    const splitVariations = [
      {
        name: "Full Body - Push Focus",
        movementPatterns: [
          "squat",
          "push_horizontal",
          "push_vertical",
          "pull_horizontal",
          "core",
        ],
        primaryMuscles: [
          "quadriceps",
          "pectorals",
          "deltoids",
          "latissimus_dorsi",
          "abdominals",
        ],
      },
      {
        name: "Full Body - Pull Focus",
        movementPatterns: [
          "hinge",
          "pull_horizontal",
          "pull_vertical",
          "push_horizontal",
          "core",
        ],
        primaryMuscles: [
          "hamstrings",
          "latissimus_dorsi",
          "rhomboids",
          "pectorals",
          "abdominals",
        ],
      },
      {
        name: "Full Body - Lower Focus",
        movementPatterns: [
          "squat",
          "hinge",
          "carry",
          "push_horizontal",
          "core",
        ],
        primaryMuscles: [
          "quadriceps",
          "hamstrings",
          "glutes",
          "pectorals",
          "abdominals",
        ],
      },
    ];

    const totalSessions = sessionsPerWeek * totalWeeks;
    return Array.from({ length: totalSessions }, (_, i) => {
      const split = splitVariations[i % splitVariations.length];
      return {
        ...split,
        focus: "full_body",
        exerciseCount: strategy.sessionStructure.exercisesPerSession,
        intensityLevel: strategy.intensityLevel.level,
      };
    });
  }

  /**
   * Generate upper/lower splits
   */
  private generateUpperLowerSplits(
    sessionsPerWeek: number,
    strategy: PlanStrategy,
    totalWeeks: number
  ): WorkoutSplit[] {
    const upperSplit: WorkoutSplit = {
      name: "Upper Body",
      focus: "upper_body",
      movementPatterns: [
        "push_horizontal",
        "push_vertical",
        "pull_horizontal",
        "pull_vertical",
      ],
      primaryMuscles: [
        "pectorals",
        "deltoids",
        "latissimus_dorsi",
        "rhomboids",
        "biceps",
        "triceps",
      ],
      exerciseCount: strategy.sessionStructure.exercisesPerSession,
      intensityLevel: strategy.intensityLevel.level,
    };

    const lowerSplit: WorkoutSplit = {
      name: "Lower Body",
      focus: "lower_body",
      movementPatterns: ["squat", "hinge", "carry", "core"],
      primaryMuscles: [
        "quadriceps",
        "hamstrings",
        "glutes",
        "calves",
        "abdominals",
      ],
      exerciseCount: strategy.sessionStructure.exercisesPerSession,
      intensityLevel: strategy.intensityLevel.level,
    };

    const splits: WorkoutSplit[] = [];
    for (let i = 0; i < sessionsPerWeek * totalWeeks; i++) {
      splits.push(i % 2 === 0 ? upperSplit : lowerSplit);
    }

    return splits;
  }

  /**
   * Generate body part splits
   */
  private generateBodyPartSplits(
    sessionsPerWeek: number,
    strategy: PlanStrategy,
    totalWeeks: number
  ): WorkoutSplit[] {
    const bodyPartSplits = [
      {
        name: "Chest & Triceps",
        focus: "chest_triceps",
        movementPatterns: ["push_horizontal", "push_vertical"],
        primaryMuscles: ["pectorals", "triceps", "deltoids"],
      },
      {
        name: "Back & Biceps",
        focus: "back_biceps",
        movementPatterns: ["pull_horizontal", "pull_vertical"],
        primaryMuscles: ["latissimus_dorsi", "rhomboids", "biceps"],
      },
      {
        name: "Legs & Glutes",
        focus: "legs_glutes",
        movementPatterns: ["squat", "hinge"],
        primaryMuscles: ["quadriceps", "hamstrings", "glutes", "calves"],
      },
      {
        name: "Shoulders & Core",
        focus: "shoulders_core",
        movementPatterns: ["push_vertical", "core"],
        primaryMuscles: ["deltoids", "abdominals"],
      },
      {
        name: "Arms & Accessories",
        focus: "arms",
        movementPatterns: ["push_horizontal", "pull_horizontal"],
        primaryMuscles: ["biceps", "triceps", "forearms"],
      },
    ];

    const totalSessions = sessionsPerWeek * totalWeeks;
    return Array.from({ length: totalSessions }, (_, i) => {
      const split = bodyPartSplits[i % bodyPartSplits.length];
      return {
        ...split,
        exerciseCount: strategy.sessionStructure.exercisesPerSession,
        intensityLevel: strategy.intensityLevel.level,
      };
    });
  }
}

export const workoutSplitService = new WorkoutSplitService();
