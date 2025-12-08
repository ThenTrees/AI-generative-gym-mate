import { PgVectorService } from "./pgVector.service";
import { logger } from "../utils/logger";
import { UserProfile } from "../types/model/userProfile.model";
import { Goal } from "../types/model/goal.model";
import { PlanStrategy } from "../types/model/planStrategy";
import { ExerciseWithScore } from "../types/model/exerciseWithScore";
import { Exercise } from "../types/model/exercise.model";
import { HealthConsideration } from "../types/model/healthConsideration";
import { SearchQuery } from "../types/model/searchQuery";
import { Objective, FitnessLevel } from "../common/common-enum";

/**
 * Service responsible for selecting exercises using RAG system
 */
export class ExerciseSelectionService {
  constructor(private pgVectorService: PgVectorService) {}

  /**
   * Select exercises using RAG system based on user profile, goal, and strategy
   */
  async selectExercisesUsingRAG(
    userProfile: UserProfile,
    goal: Goal,
    strategy: PlanStrategy
  ): Promise<ExerciseWithScore[]> {
    logger.info("Selecting exercises using RAG system...");

    // Build comprehensive search queries for different movement patterns
    const searchQueries = this.buildMovementPatternQueries(
      userProfile,
      goal,
      strategy
    );

    const allExercises: ExerciseWithScore[] = [];

    for (const query of searchQueries) {
      const results = await this.pgVectorService.similaritySearch(
        query.searchText,
        query.maxResults,
        0.3 // similarity threshold
      );

      const exerciseIds = results.map((r) => r.exerciseId);
      const exercises = await this.pgVectorService.getExercisesByIds(
        exerciseIds
      );

      // Combine exercises with their similarity scores and movement pattern info
      const exercisesWithScores: ExerciseWithScore[] = exercises.map(
        (exercise) => {
          const result = results.find((r) => r.exerciseId === exercise.id);
          return {
            exercise,
            similarityScore: result?.similarity || 0,
            movementPattern: query.movementPattern,
            priority: query.priority,
          };
        }
      );

      allExercises.push(...exercisesWithScores);
      logger.info(
        `Found ${exercisesWithScores.length} exercises for pattern: ${query.movementPattern}`
      );
    }

    // Remove duplicates and apply filtering
    const uniqueExercises = this.removeDuplicateExercises(allExercises);
    const filteredExercises = this.applyExerciseFilters(
      uniqueExercises,
      strategy
    );

    logger.info(
      `Selected ${filteredExercises.length} exercises from RAG system`
    );
    return filteredExercises;
  }

  /**
   * Build movement pattern queries for RAG search
   */
  private buildMovementPatternQueries(
    userProfile: UserProfile,
    goal: Goal,
    strategy: PlanStrategy
  ): SearchQuery[] {
    const queries: SearchQuery[] = [];

    // Core movement patterns for comprehensive training
    const movementPatterns = [
      {
        pattern: "squat",
        searchTerms: "squat hip hinge quad glute compound lower body",
        priority: 1,
        maxResults: 8,
      },
      {
        pattern: "hinge",
        searchTerms: "deadlift hinge posterior chain hamstring glute",
        priority: 1,
        maxResults: 8,
      },
      {
        pattern: "lunge",
        searchTerms:
          "lunge split squat unilateral single leg quad glute balance",
        priority: 2,
        maxResults: 6,
      },
      {
        pattern: "push_vertical",
        searchTerms: "press overhead shoulder vertical push",
        priority: 2,
        maxResults: 6,
      },
      {
        pattern: "push_horizontal",
        searchTerms: "press chest horizontal push bench",
        priority: 1,
        maxResults: 8,
      },
      {
        pattern: "pull_vertical",
        searchTerms: "pull up lat pulldown vertical pull back",
        priority: 1,
        maxResults: 8,
      },
      {
        pattern: "pull_horizontal",
        searchTerms: "row pull horizontal back rhomboids",
        priority: 1,
        maxResults: 8,
      },
      {
        pattern: "carry",
        searchTerms: "carry walk farmer core stability",
        priority: 3,
        maxResults: 4,
      },
      {
        pattern: "core",
        searchTerms: "plank core abs stability anti-extension",
        priority: 2,
        maxResults: 6,
      },
      {
        pattern: "rotation",
        searchTerms: "rotation anti-rotation core oblique twist woodchop",
        priority: 2,
        maxResults: 6,
      },
      {
        pattern: "gait",
        searchTerms: "walk run sprint locomotion movement pattern",
        priority: 3,
        maxResults: 4,
      },
    ];

    // Add cardio if weight loss or endurance goal
    if (
      goal.objectiveType === Objective.LOSE_FAT ||
      goal.objectiveType === Objective.ENDURANCE
    ) {
      movementPatterns.push({
        pattern: "cardio",
        searchTerms: "cardio conditioning metabolic circuit",
        priority: 1,
        maxResults: 10,
      });
    }

    // Build search queries with user context
    for (const pattern of movementPatterns) {
      let searchText = pattern.searchTerms;

      // Add user level
      searchText += ` ${userProfile.fitnessLevel.toLowerCase()}`;

      // Add equipment preferences
      if (
        strategy.equipmentPreferences.includes("bodyweight") ||
        strategy.equipmentPreferences.includes("body_weight") ||
        strategy.equipmentPreferences.includes("home_workout")
      ) {
        searchText += " bodyweight no equipment home";
      } else if (strategy.equipmentPreferences.includes("gym")) {
        searchText += " gym equipment weights";
      }

      // Add objective context
      searchText += ` ${goal.objectiveType.toLowerCase().replace("_", " ")}`;

      // Add health safety terms
      const searchTerms = this.buildHealthSafetyTerms(
        pattern.pattern,
        strategy.specialConsiderations
      );
      searchText += " " + searchTerms.join(" ");

      queries.push({
        movementPattern: pattern.pattern,
        searchText: searchText.trim(),
        priority: pattern.priority,
        maxResults: pattern.maxResults,
      });
    }

    return queries;
  }

  /**
   * Build health safety terms for search queries
   */
  private buildHealthSafetyTerms(
    pattern: string,
    considerations: HealthConsideration[]
  ): string[] {
    const searchTerms: string[] = [];

    for (const consideration of considerations) {
      switch (consideration.affectedArea) {
        case "knee":
          if (pattern.includes("squat")) {
            searchTerms.push("knee safe low impact");
          }
          break;
        case "spine":
          if (pattern.includes("hinge")) {
            searchTerms.push("back safe neutral spine");
          }
          break;
        case "shoulder":
          if (pattern.includes("push")) {
            searchTerms.push("shoulder safe moderate range");
          }
          break;
        case "hip":
          if (pattern.includes("squat") || pattern.includes("hinge")) {
            searchTerms.push("hip safe controlled range");
          }
          break;
        case "ankle":
          if (pattern.includes("jump") || pattern.includes("run")) {
            searchTerms.push("ankle safe low impact");
          }
          break;
        case "wrist":
          if (pattern.includes("push") || pattern.includes("press")) {
            searchTerms.push("wrist safe neutral grip");
          }
          break;
        case "neck":
          searchTerms.push("neck safe neutral position");
          break;
        case "elbow":
          if (pattern.includes("push") || pattern.includes("press")) {
            searchTerms.push("elbow safe controlled range");
          }
          break;
      }
    }

    return searchTerms;
  }

  /**
   * Remove duplicate exercises
   */
  private removeDuplicateExercises(
    exercises: ExerciseWithScore[]
  ): ExerciseWithScore[] {
    const seen = new Set<string>();
    return exercises.filter((exerciseData) => {
      if (seen.has(exerciseData.exercise.id)) {
        return false;
      }
      seen.add(exerciseData.exercise.id);
      return true;
    });
  }

  /**
   * Apply filters to exercises based on strategy
   */
  private applyExerciseFilters(
    exercises: ExerciseWithScore[],
    strategy: PlanStrategy
  ): ExerciseWithScore[] {
    return exercises.filter((exerciseData) => {
      const { exercise } = exerciseData;

      // Difficulty level filter
      const levelFilter = this.getDifficultyRange(strategy.experienceLevel);
      if (
        exercise.difficultyLevel < levelFilter.min ||
        exercise.difficultyLevel > levelFilter.max
      ) {
        return false;
      }

      // Health considerations filter
      for (const consideration of strategy.specialConsiderations) {
        if (this.violatesHealthRestriction(exercise, consideration)) {
          return false;
        }
      }

      // Equipment preference filter
      if (strategy.equipmentPreferences.length > 0) {
        const hasPreferredEquipment = this.matchesEquipmentPreference(
          exercise,
          strategy.equipmentPreferences
        );
        if (!hasPreferredEquipment) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get difficulty range based on fitness level
   */
  private getDifficultyRange(level: string): { min: number; max: number } {
    switch (level) {
      case FitnessLevel.BEGINNER:
        return { min: 1, max: 3 };
      case FitnessLevel.INTERMEDIATE:
        return { min: 2, max: 4 };
      case FitnessLevel.ADVANCED:
        return { min: 3, max: 5 };
      default:
        return { min: 1, max: 5 };
    }
  }

  /**
   * Check if exercise violates health restrictions
   */
  private violatesHealthRestriction(
    exercise: Exercise,
    consideration: HealthConsideration
  ): boolean {
    const exerciseName = exercise.name.toLowerCase();
    const instructions = exercise.instructions?.toString()?.toLowerCase() || "";

    for (const restriction of consideration.restrictions) {
      switch (restriction) {
        case "high_impact":
          if (
            exerciseName.includes("jump") ||
            exerciseName.includes("plyometric") ||
            exerciseName.includes("run") ||
            instructions.includes("jump") ||
            instructions.includes("plyometric") ||
            instructions.includes("run")
          )
            return true;
          break;

        case "deep_squat":
          if (
            exerciseName.includes("deep squat") ||
            exerciseName.includes("full squat") ||
            instructions.includes("deep squat") ||
            instructions.includes("full squat")
          )
            return true;
          break;

        case "overhead":
          if (
            exerciseName.includes("overhead") ||
            exerciseName.includes("military press") ||
            instructions.includes("overhead") ||
            instructions.includes("military press")
          )
            return true;
          break;

        case "internal_rotation":
          if (
            exerciseName.includes("internal rotation") ||
            instructions.includes("internal rotation")
          )
            return true;
          break;

        case "spinal_flexion":
          if (
            exerciseName.includes("crunch") ||
            exerciseName.includes("sit-up") ||
            instructions.includes("crunch") ||
            instructions.includes("sit-up")
          )
            return true;
          break;

        case "push_up":
          if (
            exerciseName.includes("push-up") ||
            instructions.includes("push-up")
          )
            return true;
          break;

        case "heavy_pressing":
          if (exerciseName.includes("press") || instructions.includes("press"))
            return true;
          break;

        case "heavy_shrugs":
          if (exerciseName.includes("shrug") || instructions.includes("shrug"))
            return true;
          break;

        case "awkward_positions":
          if (
            exerciseName.includes("awkward") ||
            instructions.includes("awkward")
          )
            return true;
          break;

        case "jumping":
          if (exerciseName.includes("jump") || instructions.includes("jump"))
            return true;
          break;

        case "running":
          if (exerciseName.includes("run") || instructions.includes("run"))
            return true;
          break;

        case "hyperextension":
          if (
            exerciseName.includes("hyperextension") ||
            instructions.includes("hyperextension")
          )
            return true;
          break;

        default:
          break;
      }
    }

    return false;
  }

  /**
   * Check if exercise matches equipment preferences
   */
  private matchesEquipmentPreference(
    exercise: Exercise,
    preferences: string[]
  ): boolean {
    if (
      preferences.includes("bodyweight") &&
      exercise.equipment.code === "body_weight"
    ) {
      return true;
    }
    if (
      preferences.includes("home_workout") &&
      ["body_weight", "dumbbell", "resistance_band"].includes(
        exercise.equipment.code
      )
    ) {
      return true;
    }
    if (
      preferences.includes("gym") &&
      !["body_weight"].includes(exercise.equipment.code)
    ) {
      return true;
    }
    return preferences.length === 0; // No preference means accept all
  }
}
