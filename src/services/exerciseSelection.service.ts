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
      strategy,
      goal
    );

    // Apply objective-based priority boost and sorting
    const prioritizedExercises = this.applyObjectivePriorityBoost(
      filteredExercises,
      goal.objectiveType
    );

    logger.info(
      `Selected ${prioritizedExercises.length} exercises from RAG system (objective: ${goal.objectiveType})`
    );
    return prioritizedExercises;
  }

  /**
   * Build movement pattern queries for RAG search with objective-specific optimization
   */
  private buildMovementPatternQueries(
    userProfile: UserProfile,
    goal: Goal,
    strategy: PlanStrategy
  ): SearchQuery[] {
    const queries: SearchQuery[] = [];

    // Base movement patterns for comprehensive training
    const baseMovementPatterns = [
      {
        pattern: "squat",
        searchTerms: "squat hip hinge quad glute compound lower body",
        basePriority: 1,
        baseMaxResults: 8,
      },
      {
        pattern: "hinge",
        searchTerms: "deadlift hinge posterior chain hamstring glute",
        basePriority: 1,
        baseMaxResults: 8,
      },
      {
        pattern: "lunge",
        searchTerms:
          "lunge split squat unilateral single leg quad glute balance",
        basePriority: 2,
        baseMaxResults: 6,
      },
      {
        pattern: "push_vertical",
        searchTerms: "press overhead shoulder vertical push",
        basePriority: 2,
        baseMaxResults: 6,
      },
      {
        pattern: "push_horizontal",
        searchTerms: "press chest horizontal push bench",
        basePriority: 1,
        baseMaxResults: 8,
      },
      {
        pattern: "pull_vertical",
        searchTerms: "pull up lat pulldown vertical pull back",
        basePriority: 1,
        baseMaxResults: 8,
      },
      {
        pattern: "pull_horizontal",
        searchTerms: "row pull horizontal back rhomboids",
        basePriority: 1,
        baseMaxResults: 8,
      },
      {
        pattern: "carry",
        searchTerms: "carry walk farmer core stability",
        basePriority: 3,
        baseMaxResults: 4,
      },
      {
        pattern: "core",
        searchTerms: "plank core abs stability anti-extension",
        basePriority: 2,
        baseMaxResults: 6,
      },
      {
        pattern: "rotation",
        searchTerms: "rotation anti-rotation core oblique twist woodchop",
        basePriority: 2,
        baseMaxResults: 6,
      },
      {
        pattern: "gait",
        searchTerms: "walk run sprint locomotion movement pattern",
        basePriority: 3,
        baseMaxResults: 4,
      },
    ];

    // Apply objective-specific adjustments
    const movementPatterns = baseMovementPatterns.map((pattern) => {
      const adjustments = this.getObjectiveAdjustments(
        goal.objectiveType,
        pattern.pattern
      );
      return {
        pattern: pattern.pattern,
        searchTerms: pattern.searchTerms,
        priority: Math.max(1, pattern.basePriority + adjustments.priorityDelta),
        maxResults: Math.max(
          2,
          pattern.baseMaxResults + adjustments.maxResultsDelta
        ),
        objectiveTerms: adjustments.additionalSearchTerms,
      };
    });

    // Add objective-specific patterns
    if (
      goal.objectiveType === Objective.LOSE_FAT ||
      goal.objectiveType === Objective.ENDURANCE
    ) {
      const cardioPriority = goal.objectiveType === Objective.LOSE_FAT ? 1 : 1;
      const cardioMaxResults =
        goal.objectiveType === Objective.LOSE_FAT ? 12 : 15;

      movementPatterns.push({
        pattern: "cardio",
        searchTerms:
          goal.objectiveType === Objective.LOSE_FAT
            ? "cardio HIIT high intensity interval training metabolic conditioning fat burning"
            : "cardio endurance aerobic long duration steady state",
        priority: cardioPriority,
        maxResults: cardioMaxResults,
        objectiveTerms: [],
      });
    }

    // For GAIN_MUSCLE, add more compound exercise emphasis
    if (goal.objectiveType === Objective.GAIN_MUSCLE) {
      // Increase priority for compound movements
      const compoundPatterns = [
        "squat",
        "hinge",
        "push_horizontal",
        "pull_vertical",
        "pull_horizontal",
      ];
      movementPatterns.forEach((pattern) => {
        if (compoundPatterns.includes(pattern.pattern)) {
          pattern.priority = Math.max(1, pattern.priority - 1); // Lower number = higher priority
          pattern.maxResults += 2;
        }
      });
    }

    // Build search queries with user context
    for (const pattern of movementPatterns) {
      let searchText = pattern.searchTerms;

      // Add objective-specific terms
      if (pattern.objectiveTerms.length > 0) {
        searchText += " " + pattern.objectiveTerms.join(" ");
      }

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

      // Add objective context with more specific terms
      const objectiveContext = this.getObjectiveSearchContext(
        goal.objectiveType
      );
      searchText += " " + objectiveContext;

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
   * Get objective-specific adjustments for movement patterns
   */
  private getObjectiveAdjustments(
    objective: Objective,
    pattern: string
  ): {
    priorityDelta: number;
    maxResultsDelta: number;
    additionalSearchTerms: string[];
  } {
    const adjustments = {
      priorityDelta: 0,
      maxResultsDelta: 0,
      additionalSearchTerms: [] as string[],
    };

    switch (objective) {
      case Objective.GAIN_MUSCLE:
        // Prioritize compound movements
        if (
          [
            "squat",
            "hinge",
            "push_horizontal",
            "pull_vertical",
            "pull_horizontal",
          ].includes(pattern)
        ) {
          adjustments.priorityDelta = -1; // Higher priority (lower number)
          adjustments.maxResultsDelta = 2;
          adjustments.additionalSearchTerms.push(
            "hypertrophy",
            "muscle building",
            "strength"
          );
        } else if (["lunge", "push_vertical"].includes(pattern)) {
          adjustments.priorityDelta = 0;
          adjustments.maxResultsDelta = 1;
        } else {
          adjustments.priorityDelta = 1; // Lower priority
          adjustments.maxResultsDelta = -2;
        }
        break;

      case Objective.LOSE_FAT:
        // Prioritize cardio and metabolic exercises
        if (pattern === "cardio" || pattern === "gait") {
          adjustments.priorityDelta = -2; // Highest priority
          adjustments.maxResultsDelta = 4;
          adjustments.additionalSearchTerms.push(
            "fat burning",
            "metabolic",
            "HIIT",
            "calorie burn"
          );
        } else if (
          ["squat", "hinge", "push_horizontal", "pull_vertical"].includes(
            pattern
          )
        ) {
          adjustments.priorityDelta = 0;
          adjustments.maxResultsDelta = 1;
          adjustments.additionalSearchTerms.push("circuit", "metabolic");
        } else {
          adjustments.priorityDelta = 1;
          adjustments.maxResultsDelta = -1;
        }
        break;

      case Objective.ENDURANCE:
        // Prioritize cardio and high-rep exercises
        if (pattern === "cardio" || pattern === "gait") {
          adjustments.priorityDelta = -2;
          adjustments.maxResultsDelta = 5;
          adjustments.additionalSearchTerms.push(
            "aerobic",
            "endurance",
            "steady state",
            "long duration"
          );
        } else if (["core", "rotation"].includes(pattern)) {
          adjustments.priorityDelta = -1;
          adjustments.maxResultsDelta = 2;
          adjustments.additionalSearchTerms.push("endurance", "high reps");
        } else {
          adjustments.priorityDelta = 0;
          adjustments.maxResultsDelta = 1;
          adjustments.additionalSearchTerms.push("endurance", "light weight");
        }
        break;

      case Objective.MAINTAIN:
        // Balanced approach
        adjustments.priorityDelta = 0;
        adjustments.maxResultsDelta = 0;
        adjustments.additionalSearchTerms.push("maintenance", "balanced");
        break;
    }

    return adjustments;
  }

  /**
   * Get objective-specific search context terms
   */
  private getObjectiveSearchContext(objective: Objective): string {
    switch (objective) {
      case Objective.GAIN_MUSCLE:
        return "muscle building hypertrophy strength training compound";
      case Objective.LOSE_FAT:
        return "fat loss weight loss calorie burn metabolic HIIT";
      case Objective.ENDURANCE:
        return "endurance stamina aerobic cardiovascular";
      case Objective.MAINTAIN:
        return "maintenance health fitness balanced";
    }
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
   * Apply filters to exercises based on strategy and goal
   */
  private applyExerciseFilters(
    exercises: ExerciseWithScore[],
    strategy: PlanStrategy,
    goal: Goal
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

      // Objective-based category filter
      if (!this.matchesObjectiveCategory(exercise, goal.objectiveType)) {
        return false;
      }

      return true;
    });
  }

  /**
   * Check if exercise category and type match objective requirements
   */
  private matchesObjectiveCategory(
    exercise: Exercise,
    objective: Objective
  ): boolean {
    const category = exercise.exerciseCategory.code.toLowerCase();
    const exerciseType = exercise.exerciseType?.toUpperCase() || "";
    const exerciseName = exercise.name.toLowerCase();
    const tags = exercise.tags?.join(" ").toLowerCase() || "";

    switch (objective) {
      case Objective.GAIN_MUSCLE:
        // Prefer strength exercises with compound/freeweight/machine types
        // Allow some cardio for conditioning (HIIT/metabolic only)
        if (category === "cardio" || exerciseType === "CARDIO") {
          // Only allow cardio if it's HIIT or metabolic (not pure endurance)
          return (
            exerciseName.includes("hiit") ||
            exerciseName.includes("circuit") ||
            exerciseName.includes("metabolic") ||
            exerciseName.includes("sprint") ||
            tags.includes("hiit") ||
            tags.includes("metabolic")
          );
        }
        // Prefer strength category with compound/freeweight/machine types
        if (category === "strength") {
          return (
            exerciseType === "COMPOUND" ||
            exerciseType === "FREEWEIGHT" ||
            exerciseType === "MACHINE" ||
            exerciseType === "ISOLATION" ||
            exerciseName.includes("compound") ||
            tags.includes("compound")
          );
        }
        // Allow plyometrics for power development
        if (category === "plyometrics" || exerciseType === "PLYOMETRIC") {
          return true;
        }
        return false;

      case Objective.LOSE_FAT:
        // Prefer cardio, plyometric, and bodyweight exercises
        if (category === "cardio" || exerciseType === "CARDIO") {
          return true; // All cardio is good for fat loss
        }
        // Plyometric exercises are excellent for fat loss
        if (category === "plyometrics" || exerciseType === "PLYOMETRIC") {
          return true;
        }
        // Bodyweight exercises for metabolic conditioning
        if (exerciseType === "BODYWEIGHT") {
          return true;
        }
        // Strength exercises are also good, especially compound
        if (category === "strength") {
          return (
            exerciseType === "COMPOUND" ||
            exerciseType === "FREEWEIGHT" ||
            exerciseName.includes("compound") ||
            exerciseName.includes("squat") ||
            exerciseName.includes("deadlift") ||
            exerciseName.includes("press") ||
            tags.includes("compound")
          );
        }
        // Core exercises for stability and metabolic benefit
        if (category === "core") {
          return true;
        }
        return false;

      case Objective.ENDURANCE:
        // Strongly prefer cardio and bodyweight exercises
        if (category === "cardio" || exerciseType === "CARDIO") {
          return true;
        }
        // Bodyweight exercises for muscular endurance
        if (exerciseType === "BODYWEIGHT") {
          return true;
        }
        // Allow strength if it's endurance-focused (high reps, light weight)
        if (category === "strength") {
          return (
            exerciseType === "BODYWEIGHT" ||
            exerciseName.includes("endurance") ||
            exerciseName.includes("circuit") ||
            tags.includes("endurance") ||
            tags.includes("aerobic")
          );
        }
        // Core exercises for stability endurance
        if (category === "core") {
          return true;
        }
        return false;

      case Objective.MAINTAIN:
        // Accept all categories and types for maintenance
        return true;

      default:
        return true;
    }
  }

  /**
   * Apply objective-based priority boost to exercises using both category and type
   */
  private applyObjectivePriorityBoost(
    exercises: ExerciseWithScore[],
    objective: Objective
  ): ExerciseWithScore[] {
    return exercises
      .map((exerciseData) => {
        let priorityBoost = 0;
        const { exercise } = exerciseData;
        const category = exercise.exerciseCategory.code.toLowerCase();
        const exerciseType = exercise.exerciseType?.toUpperCase() || "";
        const exerciseName = exercise.name.toLowerCase();
        const tags = exercise.tags?.join(" ").toLowerCase() || "";

        switch (objective) {
          case Objective.GAIN_MUSCLE:
            // Highest priority: Compound exercises (COMPOUND type or compound movements)
            if (
              exerciseType === "COMPOUND" ||
              exerciseName.includes("squat") ||
              exerciseName.includes("deadlift") ||
              exerciseName.includes("bench press") ||
              exerciseName.includes("overhead press") ||
              exerciseName.includes("row") ||
              exerciseName.includes("pull-up") ||
              tags.includes("compound")
            ) {
              priorityBoost = -3; // Highest priority
            }
            // High priority: Freeweight and Machine strength exercises
            else if (
              (category === "strength" &&
                (exerciseType === "FREEWEIGHT" ||
                  exerciseType === "MACHINE")) ||
              exerciseType === "ISOLATION"
            ) {
              priorityBoost = -2;
            }
            // Medium priority: Other strength exercises
            else if (category === "strength") {
              priorityBoost = -1;
            }
            // Lower priority: Plyometric for power (still useful)
            else if (
              category === "plyometrics" ||
              exerciseType === "PLYOMETRIC"
            ) {
              priorityBoost = 0;
            }
            // Lowest priority: Cardio (only for conditioning)
            else if (category === "cardio" || exerciseType === "CARDIO") {
              priorityBoost = 2;
            }
            break;

          case Objective.LOSE_FAT:
            // Highest priority: Cardio and Plyometric exercises
            if (
              category === "cardio" ||
              exerciseType === "CARDIO" ||
              category === "plyometrics" ||
              exerciseType === "PLYOMETRIC" ||
              exerciseName.includes("hiit") ||
              exerciseName.includes("circuit") ||
              exerciseName.includes("metabolic") ||
              exerciseName.includes("sprint") ||
              exerciseName.includes("burpee") ||
              exerciseName.includes("jump") ||
              tags.includes("fat burning") ||
              tags.includes("metabolic") ||
              tags.includes("hiit")
            ) {
              priorityBoost = -4; // Highest priority
            }
            // High priority: Bodyweight exercises (metabolic benefit)
            else if (exerciseType === "BODYWEIGHT") {
              priorityBoost = -2;
            }
            // Medium priority: Compound strength exercises
            else if (
              exerciseType === "COMPOUND" ||
              exerciseName.includes("squat") ||
              exerciseName.includes("deadlift") ||
              exerciseName.includes("burpee") ||
              tags.includes("compound")
            ) {
              priorityBoost = -1;
            }
            // Lower priority: Other strength exercises
            else if (category === "strength") {
              priorityBoost = 0;
            }
            // Core exercises for stability
            else if (category === "core") {
              priorityBoost = -1;
            }
            break;

          case Objective.ENDURANCE:
            // Highest priority: Cardio exercises
            if (
              category === "cardio" ||
              exerciseType === "CARDIO" ||
              exerciseName.includes("run") ||
              exerciseName.includes("bike") ||
              exerciseName.includes("row") ||
              exerciseName.includes("swim") ||
              tags.includes("endurance") ||
              tags.includes("aerobic")
            ) {
              priorityBoost = -4; // Highest priority
            }
            // High priority: Bodyweight exercises for muscular endurance
            else if (exerciseType === "BODYWEIGHT") {
              priorityBoost = -2;
            }
            // Medium priority: Endurance-focused strength exercises
            else if (
              tags.includes("endurance") ||
              exerciseName.includes("circuit") ||
              (category === "strength" &&
                (exerciseType === "BODYWEIGHT" ||
                  exerciseName.includes("endurance")))
            ) {
              priorityBoost = -1;
            }
            // Core exercises for stability endurance
            else if (category === "core") {
              priorityBoost = -1;
            }
            // Lower priority: Pure strength training
            else if (category === "strength" && exerciseType === "COMPOUND") {
              priorityBoost = 1;
            } else if (category === "strength") {
              priorityBoost = 2;
            }
            break;

          case Objective.MAINTAIN:
            // Balanced approach, slight preference for compound and bodyweight
            if (exerciseType === "COMPOUND" || exerciseType === "BODYWEIGHT") {
              priorityBoost = -1;
            } else {
              priorityBoost = 0;
            }
            break;
        }

        return {
          ...exerciseData,
          priority: Math.max(1, exerciseData.priority + priorityBoost),
        };
      })
      .sort((a, b) => {
        // Sort by priority first (lower number = higher priority)
        const priorityDiff = a.priority - b.priority;
        if (priorityDiff !== 0) return priorityDiff;

        // Then by similarity score
        return b.similarityScore - a.similarityScore;
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
