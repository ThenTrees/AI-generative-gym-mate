import {
  MealPlanGenerator,
  mealPlanGenerator,
} from "./mealPlanGenerator.service";
import { Pool, types } from "pg";
import { PgVectorService } from "./pgVector.service";
import { DATABASE_CONFIG } from "../configs/database";
import { logger } from "../utils/logger";
import { PlanRequest } from "../types/request/planRequest";
import { Goal } from "../types/model/goal.model";
import { UserProfile } from "../types/model/userProfile.model";
import {
  FitnessLevel,
  Gender,
  Intensity,
  Objective,
} from "../common/common-enum";
import { ExerciseWithScore } from "../types/model/exerciseWithScore";
import { Exercise } from "../types/model/exercise.model";
import { PlanDay } from "../types/model/planDay.model";
import { PlanItem } from "../types/model/planItem.model";
import { Prescription } from "../types/model/prescription";
import { IntensityLevel } from "../types/model/intensityLevel";
import { SessionStructure } from "../types/model/sessionStructure";
import { HealthConsideration } from "../types/model/healthConsideration";
import { VolumeTargets } from "../types/model/volumeTargets";
import { RestPeriods } from "../types/model/restPeriods";
import { SearchQuery } from "../types/model/searchQuery";
import { WorkoutCalculator } from "../utils/calculators";
import { WORKOUT_CONSTANTS } from "../utils/constants";
import {
  ProgressiveOverloadConfig,
  ProgressiveOverloadCalculator,
  WeeklyProgression,
} from "../types/model/progressiveOverload";
import dayjs from "dayjs";
import { Plan } from "../types/model/plan.model";
import { PlanStrategy } from "../types/model/planStrategy";
import { WorkoutSplit } from "../types/model/workoutSplit";

types.setTypeParser(1082, (val) => val);

class WorkoutPlanGeneratorService {
  private pool: Pool;
  private pgVectorService: PgVectorService;
  private workoutCalculator: WorkoutCalculator;
  private mealPlanGenerator: MealPlanGenerator;
  constructor() {
    this.pool = new Pool(DATABASE_CONFIG);
    this.pgVectorService = new PgVectorService();
    this.workoutCalculator = new WorkoutCalculator();
    this.mealPlanGenerator = new MealPlanGenerator();
  }
  async initialize(): Promise<void> {
    logger.info("Initializing Workout Plan Generator Service...");
    await this.pgVectorService.initialize();
    console.log("Workout Plan Generator Service ready");
  }
  /**
   * Generates a personalized workout plan based on user profile and goals
   * @param request - User profile and goal information
   * @returns Promise<Plan> - Generated workout plan with exercises and prescriptions
   * @throws AppError - If user profile is invalid or goal cannot be achieved
   */
  async generateWorkoutPlan(request: PlanRequest): Promise<Plan> {
    logger.info(
      `[WorkoutPlanService] - Generating workout plan for user ${request.userId}`
    );
    const startTime = Date.now();
    try {
      // check user profile already exist
      const profile = await mealPlanGenerator.getProfile(request.userId);
      if (!profile) {
        throw new Error("User profile not found");
      }

      const goal = await mealPlanGenerator.getGoalByUser(request.userId);
      if (!goal) {
        throw new Error("No active goal found");
      }
      // Step 1: Analyze user requirements and build search strategy
      const planStrategy = this.analyzePlanRequirements(profile, goal);

      // Step 2: Find relevant exercises using RAG
      const selectedExercises = await this.selectExercisesUsingRAG(
        profile,
        goal,
        planStrategy
      );

      // Step 3: Calculate suggested weeks for the plan
      const suggestedWeeks = this.calculateSuggestedWeeks(profile, goal);
      logger.info(
        `[WorkoutPlanService] - Suggested plan duration: ${suggestedWeeks} weeks`
      );

      // Step 4: Generate workout splits
      const workoutSplits = this.generateWorkoutSplits(
        goal,
        planStrategy,
        suggestedWeeks
      );

      const currentDate = dayjs();
      const endDate = currentDate.add(suggestedWeeks, "week");
      // Step 5: Create plan structure in database
      const plan = await this.createPlanInDatabase(
        profile,
        goal,
        request,
        workoutSplits,
        selectedExercises,
        endDate,
        suggestedWeeks,
        planStrategy
      );

      // Step 6: Generate detailed plan days and items
      const planDays = await this.generatePlanDays(
        plan,
        workoutSplits,
        selectedExercises,
        profile,
        goal
      );

      const generationTime = Date.now() - startTime;

      console.log(`Plan generated successfully in ${generationTime}ms`);
      console.log(
        `- Total exercises: ${planDays.reduce(
          (sum, day) => sum + day.planItems.length,
          0
        )}`
      );
      console.log(
        `- Average session duration: ${Math.round(
          planDays.reduce((sum, day) => sum + day.totalDuration, 0) /
            planDays.length /
            60
        )} minutes`
      );

      return {
        ...plan,
        planDays,
        aiMetadata: {
          generationTimeMs: generationTime,
          searchStrategy: planStrategy,
          totalExercisesConsidered: selectedExercises.length,
        },
      };
    } catch (error) {
      console.error("Failed to generate workout plan:", error);
      throw error;
    }
  }

  /**
   *
   * @param request
   * @returns
   */
  private analyzePlanRequirements(
    userProfile: UserProfile,
    goal: Goal
  ): PlanStrategy {
    const suggestedWeeks = this.calculateSuggestedWeeks(userProfile, goal);

    return {
      primaryObjective: goal.objectiveType,
      experienceLevel: userProfile.fitnessLevel,
      // based on goal -> strategy suitable for user.
      sessionStructure: this.determineSessionStructure(goal),
      equipmentPreferences: [], // TODO: update late
      // read field healthNote, if seen knee, back, shoulder problems -> warning
      specialConsiderations: this.analyzeHealthConsiderations(userProfile),
      // check level fitness for user -> calc intensity suitable
      intensityLevel: this.calculateIntensityLevel(userProfile, goal),
      // set, rep suitable for user based on level and objective
      volumeTargets: this.calculateVolumeTargets(goal, userProfile),
      // progressive overload configuration
      progressiveOverloadConfig:
        ProgressiveOverloadCalculator.createDefaultConfig(
          userProfile.fitnessLevel,
          goal.objectiveType,
          suggestedWeeks
        ),
    };
  }

  /**
   * choose structure suitable for user (based on session per week)
   * @param goal
   * @returns
   */
  private determineSessionStructure(goal: Goal): SessionStructure {
    const { sessionsPerWeek, sessionMinutes } = goal;

    // Calculate optimal exercises per session (5-8 range)
    const exercisesPerSession = this.calculateOptimalExerciseCount(
      sessionsPerWeek,
      sessionMinutes
    );

    if (sessionsPerWeek <= 2) {
      return {
        type: "full_body",
        exercisesPerSession,
        splitStrategy: "minimal_frequency",
      };
    } else if (sessionsPerWeek <= 3) {
      return {
        type: "full_body_varied",
        exercisesPerSession,
        splitStrategy: "moderate_frequency",
      };
    } else if (sessionsPerWeek <= 4) {
      return {
        type: "upper_lower",
        exercisesPerSession,
        splitStrategy: "upper_lower_split",
      };
    } else {
      return {
        type: "body_part_split",
        exercisesPerSession,
        splitStrategy: "high_frequency",
      };
    }
  }

  /**
   * Calculate optimal number of exercises per session (5-8 range)
   * @param sessionsPerWeek - Number of sessions per week
   * @param sessionMinutes - Duration of each session in minutes
   * @returns number - Optimal exercises per session (5-8)
   */
  private calculateOptimalExerciseCount(
    sessionsPerWeek: number,
    sessionMinutes: number
  ): number {
    // Fixed logic: Always return 5-8 exercises regardless of session duration
    // This prevents overwhelming users with too many exercises

    if (sessionsPerWeek <= 2) {
      // Low frequency = more exercises per session (6-8)
      return 7; // Balanced for low frequency
    } else if (sessionsPerWeek <= 3) {
      // Moderate frequency = balanced (5-7)
      return 6; // Good balance
    } else if (sessionsPerWeek <= 4) {
      // High frequency = fewer exercises per session (5-6)
      return 5; // Minimal for high frequency
    } else {
      // Very high frequency = minimal exercises per session (5-6)
      return 5; // Minimal for very high frequency
    }
  }

  /**
   * analyze about health for user
   * @param userProfile
   * @returns list health considerations
   */
  private analyzeHealthConsiderations(
    userProfile: UserProfile
  ): HealthConsideration[] {
    const considerations: HealthConsideration[] = [];

    if (userProfile.healthNote) {
      const healthNote = userProfile.healthNote.toLowerCase();
      // if have problem about health (knee)
      if (healthNote.includes("knee")) {
        logger.info("people with knee problems");
        // những cân nhắc
        considerations.push({
          type: "injury_history",
          affectedArea: "knee",
          restrictions: ["high_impact", "deep_squat"],
          modifications: ["partial_range", "low_impact_alternatives"],
        });
      }

      // if have problem about back
      if (healthNote.includes("back")) {
        logger.info("people with back problems");
        considerations.push({
          type: "joint_limitation",
          affectedArea: "spine",
          restrictions: ["heavy_loading", "spinal_flexion"],
          modifications: ["neutral_spine", "core_focus"],
        });
      }

      // if have problem about shoulder
      if (healthNote.includes("shoulder")) {
        logger.info("people with shoulder problems");
        considerations.push({
          type: "injury_history",
          affectedArea: "shoulder",
          restrictions: ["overhead", "internal_rotation"],
          modifications: ["reduced_range", "stability_focus"],
        });
      }

      if (healthNote.includes("hip")) {
        logger.info("people with hip problems");
        considerations.push({
          type: "mobility_issue",
          affectedArea: "hip",
          restrictions: ["deep_squat", "high_impact"],
          modifications: ["shallow_squat", "controlled_range"],
        });
      }

      if (healthNote.includes("ankle")) {
        logger.info("people with ankle problems");
        considerations.push({
          type: "injury_history",
          affectedArea: "ankle",
          restrictions: ["jumping", "running"],
          modifications: ["low_impact", "balance_training"],
        });
      }

      if (healthNote.includes("wrist")) {
        logger.info("people with wrist problems");
        considerations.push({
          type: "injury_history",
          affectedArea: "wrist",
          restrictions: ["push_up", "heavy_pressing"],
          modifications: ["neutral_grip", "wrist_support"],
        });
      }

      if (healthNote.includes("neck")) {
        logger.info("people with neck problems");
        considerations.push({
          type: "mobility_issue",
          affectedArea: "neck",
          restrictions: ["heavy_shrugs", "awkward_positions"],
          modifications: ["neutral_position", "mobility_focus"],
        });
      }

      if (healthNote.includes("elbow")) {
        logger.info("people with elbow problems");
        considerations.push({
          type: "injury_history",
          affectedArea: "elbow",
          restrictions: ["heavy_pressing", "hyperextension"],
          modifications: ["controlled_range", "supportive_bracing"],
        });
      }
    }

    if (considerations.length == 0) {
      logger.info("health for user very good!");
    }
    return considerations;
  }

  /**
   * Calculate suggested number of weeks for the workout plan based on user profile and goal
   * @param userProfile - User's fitness profile
   * @param goal - User's fitness goal
   * @returns number - Suggested number of weeks
   */
  private calculateSuggestedWeeks(
    userProfile: UserProfile,
    goal: Goal
  ): number {
    const fitnessLevel = userProfile.fitnessLevel;
    const objective = goal.objectiveType;

    // Get base weeks from constants
    let suggestedWeeks =
      WORKOUT_CONSTANTS.SUGGESTED_WEEKS[fitnessLevel][objective];

    // Adjust based on user's specific circumstances
    const adjustments = this.calculateWeekAdjustments(userProfile, goal);
    suggestedWeeks += adjustments;

    // Ensure minimum and maximum bounds
    const minWeeks = 4;
    const maxWeeks = 16;

    return Math.max(minWeeks, Math.min(maxWeeks, suggestedWeeks));
  }

  /**
   * Calculate adjustments to suggested weeks based on user profile and goal specifics
   * @param userProfile - User's fitness profile
   * @param goal - User's fitness goal
   * @returns number - Week adjustments (can be positive or negative)
   */
  private calculateWeekAdjustments(
    userProfile: UserProfile,
    goal: Goal
  ): number {
    let adjustments = 0;

    // Health considerations adjustments
    if (userProfile.healthNote) {
      const healthNote = userProfile.healthNote.toLowerCase();

      // If user has health issues, suggest longer plan for gradual progression
      if (
        healthNote.includes("knee") ||
        healthNote.includes("back") ||
        healthNote.includes("shoulder") ||
        healthNote.includes("hip")
      ) {
        adjustments += 2; // Add 2 weeks for safer progression
      }
    }

    // Session frequency adjustments
    if (goal.sessionsPerWeek <= 2) {
      adjustments += 2; // Fewer sessions per week = longer plan needed
    } else if (goal.sessionsPerWeek >= 5) {
      adjustments -= 1; // More sessions per week = can be shorter
    }

    // Session duration adjustments
    if (goal.sessionMinutes <= 30) {
      adjustments += 1; // Shorter sessions = longer plan needed
    } else if (goal.sessionMinutes >= 90) {
      adjustments -= 1; // Longer sessions = can be shorter
    }

    // Age considerations (if available in user profile)
    if (userProfile.age) {
      if (userProfile.age > 50) {
        adjustments += 1; // Older users may need more gradual progression
      } else if (userProfile.age < 25) {
        adjustments -= 1; // Younger users can progress faster
      }
    }

    return adjustments;
  }

  /**
   * analyze user info, calculate and suggestion intensity level for user
   * @param userProfile
   * @param goal
   * @returns
   */
  private calculateIntensityLevel(
    userProfile: UserProfile,
    goal: Goal
  ): IntensityLevel {
    let baseIntensity = WORKOUT_CONSTANTS.BASE_INTENSITY; // Medium

    // Level adjustments, intensity = cường độ
    if (userProfile.fitnessLevel === FitnessLevel.BEGINNER)
      baseIntensity = WORKOUT_CONSTANTS.BASE_INTENSITY - 2;
    else if (userProfile.fitnessLevel === FitnessLevel.ADVANCED)
      baseIntensity = WORKOUT_CONSTANTS.BASE_INTENSITY + 2;

    // Goal adjustments
    if (goal.objectiveType === Objective.LOSE_FAT) baseIntensity += 1;
    else if (goal.objectiveType === Objective.ENDURANCE) baseIntensity += 1;

    return {
      level: Math.max(1, Math.min(10, baseIntensity)),
      rpeTarget: Math.max(5, Math.min(9, baseIntensity + 1)),
      restPeriods: this.calculateRestPeriods(
        goal.objectiveType,
        userProfile.fitnessLevel
      ),
    };
  }

  /**
   * based on objective and levelFitness, bring out rest time suitable
   * @param objective
   * @param level
   * @returns
   */
  private calculateRestPeriods(objective: string, level: string): RestPeriods {
    let baseTimes: RestPeriods = {
      compound: WORKOUT_CONSTANTS.MAX_SESSION_MINUTES,
      isolation: 60,
      cardio: WORKOUT_CONSTANTS.MIN_SESSION_MINUTES,
    };

    const addDelta = (rp: RestPeriods, d: number): RestPeriods => ({
      compound: rp.compound + d,
      isolation: rp.isolation + d,
      cardio: rp.cardio + d,
    });

    const subDelta = (rp: RestPeriods, d: number): RestPeriods =>
      addDelta(rp, -d);

    // Objective adjustments
    if (objective === Objective.LOSE_FAT) {
      baseTimes = {
        compound: WORKOUT_CONSTANTS.MAX_SESSION_MINUTES * 0.75,
        isolation: WORKOUT_CONSTANTS.MIN_SESSION_MINUTES * 0.75,
        cardio: WORKOUT_CONSTANTS.MIN_SESSION_MINUTES * 0.5,
      };
    } else if (objective === Objective.GAIN_MUSCLE) {
      baseTimes = {
        compound: WORKOUT_CONSTANTS.MAX_SESSION_MINUTES * 1.5,
        isolation: WORKOUT_CONSTANTS.MIN_SESSION_MINUTES * 1.5,
        cardio: baseTimes.cardio,
      };
    }

    // Level adjustments
    if (level === FitnessLevel.BEGINNER) {
      baseTimes = addDelta(baseTimes, WORKOUT_CONSTANTS.MIN_SESSION_MINUTES);
    } else if (level === FitnessLevel.ADVANCED) {
      baseTimes = subDelta(baseTimes, WORKOUT_CONSTANTS.MIN_SESSION_MINUTES);
    }
    return baseTimes;
  }

  private calculateVolumeTargets(
    goal: Goal,
    userProfile: UserProfile
  ): VolumeTargets {
    const baseVolume: VolumeTargets = {
      setsPerMuscleGroup: WORKOUT_CONSTANTS.BASE_SETS,
      repsRange: [8, 12] as const,
      weeklyVolume: goal.sessionsPerWeek * goal.sessionMinutes,
    };

    // Objective adjustments
    switch (goal.objectiveType) {
      case Objective.GAIN_MUSCLE:
        baseVolume.setsPerMuscleGroup = WORKOUT_CONSTANTS.BASE_SETS + 4;
        baseVolume.repsRange = [8, 12] as const;
        break;
      case Objective.LOSE_FAT:
        baseVolume.setsPerMuscleGroup = WORKOUT_CONSTANTS.BASE_SETS - 2;
        baseVolume.repsRange = [12, 15] as const;
        break;
      case Objective.ENDURANCE:
        baseVolume.setsPerMuscleGroup = WORKOUT_CONSTANTS.BASE_SETS - 4;
        baseVolume.repsRange = [15, 25] as const;
        break;
      case Objective.MAINTAIN:
      default:
        baseVolume.setsPerMuscleGroup = 12;
        baseVolume.repsRange = [8, 12] as const;
        break;
    }

    // Level adjustments
    if (userProfile.fitnessLevel === FitnessLevel.BEGINNER) {
      baseVolume.setsPerMuscleGroup = Math.max(
        6,
        Math.floor(baseVolume.setsPerMuscleGroup * 0.7)
      );
    } else if (userProfile.fitnessLevel === FitnessLevel.ADVANCED) {
      baseVolume.setsPerMuscleGroup = Math.floor(
        baseVolume.setsPerMuscleGroup * 1.3
      );
    }

    return baseVolume;
  }

  private async selectExercisesUsingRAG(
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
      console.log(`exercisesWithScores: ${exercisesWithScores.length}`);
    }

    // Remove duplicates and apply filtering
    const uniqueExercises = this.removeDuplicateExercises(allExercises);
    const filteredExercises = this.applyExerciseFilters(
      uniqueExercises,
      strategy
    );

    console.log(
      `Selected ${filteredExercises.length} exercises from RAG system`
    );
    return filteredExercises;
  }

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
        // strategy.equipmentPreferences.length === 0 || current is empty, i'll enhance in the future
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

      let searchTerms = [];

      for (const consideration of strategy.specialConsiderations) {
        switch (consideration.affectedArea) {
          case "knee":
            // Nếu động tác liên quan squat, thêm từ khóa an toàn cho đầu gối
            if (pattern.pattern.includes("squat")) {
              searchTerms.push("knee safe low impact");
            }
            break;
          case "spine":
            // Nếu động tác liên quan hinge, thêm từ khóa an toàn cho lưng
            if (pattern.pattern.includes("hinge")) {
              searchTerms.push("back safe neutral spine");
            }
            break;
          case "shoulder":
            // Nếu động tác liên quan push, thêm từ khóa an toàn cho vai
            if (pattern.pattern.includes("push")) {
              searchTerms.push("shoulder safe moderate range");
            }
            break;
          case "hip":
            if (
              pattern.pattern.includes("squat") ||
              pattern.pattern.includes("hinge")
            ) {
              searchTerms.push("hip safe controlled range");
            }
            break;
          case "ankle":
            if (
              pattern.pattern.includes("jump") ||
              pattern.pattern.includes("run")
            ) {
              searchTerms.push("ankle safe low impact");
            }
            break;
          case "wrist":
            if (
              pattern.pattern.includes("push") ||
              pattern.pattern.includes("press")
            ) {
              searchTerms.push("wrist safe neutral grip");
            }
            break;
          case "neck":
            searchTerms.push("neck safe neutral position");
            break;
          case "elbow":
            if (
              pattern.pattern.includes("push") ||
              pattern.pattern.includes("press")
            ) {
              searchTerms.push("elbow safe controlled range");
            }
            break;
        }
      }

      // Ghép các từ khóa thành một chuỗi
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

  private applyExerciseFilters(
    exercises: ExerciseWithScore[],
    strategy: PlanStrategy
  ): ExerciseWithScore[] {
    return exercises.filter((exerciseData) => {
      const { exercise } = exerciseData;

      // Difficulty level filter
      //todo
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

  // TODO: must change Difficulty level
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

  private matchesEquipmentPreference(
    exercise: Exercise,
    preferences: string[]
  ): boolean {
    if (
      preferences.includes("bodyweight") &&
      exercise.equipment === "body_weight"
    ) {
      return true;
    }
    if (
      preferences.includes("home_workout") &&
      ["body_weight", "dumbbell", "resistance_band"].includes(
        exercise.equipment
      )
    ) {
      return true;
    }
    if (
      preferences.includes("gym") &&
      !["body_weight"].includes(exercise.equipment)
    ) {
      return true;
    }
    return preferences.length === 0; // No preference means accept all
  }

  private generateWorkoutSplits(
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

  private generateFullBodySplits(
    sessionsPerWeek: number,
    strategy: PlanStrategy,
    totalWeeks: number
  ): WorkoutSplit[] {
    const splits: WorkoutSplit[] = [];

    for (let i = 0; i < sessionsPerWeek * totalWeeks; i++) {
      splits.push({
        name: `Full Body ${i + 1}`, // must generate from AI, diverse title for plan day.
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
    const result = Array.from({ length: totalSessions }, (_, i) => {
      const split = splitVariations[i % splitVariations.length];
      return {
        ...split,
        focus: "full_body",
        exerciseCount: strategy.sessionStructure.exercisesPerSession,
        intensityLevel: strategy.intensityLevel.level,
      };
    });
    return result;
  }

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
    const result = Array.from({ length: totalSessions }, (_, i) => {
      const split = bodyPartSplits[i % bodyPartSplits.length];
      return {
        ...split,
        exerciseCount: strategy.sessionStructure.exercisesPerSession,
        intensityLevel: strategy.intensityLevel.level,
      };
    });
    return result;
  }

  private async createPlanInDatabase(
    userProfile: UserProfile,
    goal: Goal,
    request: PlanRequest,
    workoutSplits: WorkoutSplit[],
    exercises: ExerciseWithScore[],
    endDate: dayjs.Dayjs,
    suggestedWeeks: number,
    planStrategy: PlanStrategy
  ): Promise<Plan> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      // Generate AI-suggested title
      const aiGeneratedTitle = this.generatePlanTitle(
        userProfile,
        goal,
        suggestedWeeks
      );
      logger.info(
        `[WorkoutPlanService] - Generated title: "${aiGeneratedTitle}"`
      );

      // Insert plan
      const planResult = await client.query(
        `
        INSERT INTO plans (user_id, goal_id, title, description, source, cycle_weeks, status, ai_metadata, generation_params, end_date)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
        [
          request.userId,
          goal.id || null,
          aiGeneratedTitle,
          `${goal.sessionsPerWeek} sessions/week - ${goal.sessionMinutes} min/session`,
          "AI",
          suggestedWeeks,
          "DRAFT",
          JSON.stringify({
            totalExercises: exercises.length,
            avgSimilarityScore:
              exercises.reduce((sum, e) => sum + e.similarityScore, 0) /
              exercises.length,
            workoutSplits: workoutSplits.map((s) => s.name),
            suggestedWeeks: suggestedWeeks,
            planDuration: `${suggestedWeeks} weeks`,
            progressiveOverload: {
              method: planStrategy.progressiveOverloadConfig.method,
              phases: planStrategy.progressiveOverloadConfig.phases.map(
                (p) => ({
                  phase: p.phase,
                  duration: p.duration,
                  intensityMultiplier: p.intensityMultiplier,
                  volumeMultiplier: p.volumeMultiplier,
                })
              ),
              deloadFrequency:
                planStrategy.progressiveOverloadConfig.deloadFrequency,
            },
            titleGeneration: {
              aiGenerated: true,
              originalTemplate: aiGeneratedTitle.split(" (")[0], // Remove duration/frequency suffixes
              customizationApplied:
                aiGeneratedTitle !== aiGeneratedTitle.split(" (")[0],
            },
          }),
          JSON.stringify({
            userProfile: userProfile,
            goal: goal,
          }),
          endDate,
        ]
      );

      const plan = planResult.rows[0];

      await client.query("COMMIT");

      return {
        id: plan.id,
        userId: plan.user_id,
        goalId: plan.goal_id,
        title: plan.title,
        description: plan.description,
        totalWeeks: plan.cycle_weeks,
        totalDays: plan.cycle_weeks * goal.sessionsPerWeek,
        createdAt: plan.created_at,
        endDate: plan.end_date,
        planDays: [], // Will be populated by generatePlanDays
        aiMetadata: plan.ai_metadata,
        generationParams: plan.generation_params,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async generatePlanDays(
    plan: Plan,
    workoutSplits: WorkoutSplit[],
    exercises: ExerciseWithScore[],
    profile: UserProfile,
    goal: Goal
  ): Promise<PlanDay[]> {
    const client = await this.pool.connect();
    const planDays: PlanDay[] = [];

    try {
      await client.query("BEGIN");

      for (
        let dayIndex = 0;
        dayIndex < goal.sessionsPerWeek * plan.totalWeeks;
        dayIndex++
      ) {
        const split = workoutSplits[dayIndex];

        // Insert plan_day
        const planDayResult = await client.query(
          `
          INSERT INTO plan_days (plan_id, day_index, split_name, scheduled_date)
          VALUES ($1, $2, $3, $4)
          RETURNING *
        `,
          [
            plan.id,
            dayIndex + 1,
            split.name,
            this.calculateScheduledDate(dayIndex, goal.sessionsPerWeek),
          ]
        );

        const planDayRow = planDayResult.rows[0];

        // Select exercises for this split
        const selectedExercises = this.selectExercisesForSplit(
          split,
          exercises
        );

        // Generate plan items
        const planItems: PlanItem[] = [];

        for (
          let itemIndex = 0;
          itemIndex < selectedExercises.length;
          itemIndex++
        ) {
          const exerciseData = selectedExercises[itemIndex];
          const prescription = this.generatePrescription(
            exerciseData.exercise,
            profile,
            goal,
            split
          );

          // Insert plan_item
          const planItemResult = await client.query(
            `
            INSERT INTO plan_items (plan_day_id, exercise_id, item_index, prescription, notes, similarity_score)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
          `,
            [
              planDayRow.id,
              exerciseData.exercise.id,
              itemIndex + 1,
              JSON.stringify(prescription),
              this.generateExerciseNote(exerciseData.exercise, profile),
              exerciseData.similarityScore,
            ]
          );

          planItems.push({
            exercise: exerciseData.exercise,
            itemIndex: itemIndex + 1,
            prescription,
            note: this.generateExerciseNote(exerciseData.exercise, profile),
            // similarityScore: exerciseData.similarityScore,
          });
        }

        planDays.push({
          dayIndex: dayIndex + 1,
          scheduledDate: planDayRow.scheduled_date,
          splitName: split.name,
          planItems,
          totalDuration: this.calculateTotalDuration(planItems),
        });
      }

      await client.query("COMMIT");
      return planDays;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private selectExercisesForSplit(
    split: WorkoutSplit,
    availableExercises: ExerciseWithScore[]
  ): ExerciseWithScore[] {
    // Filter exercises by movement patterns and muscles
    let relevantExercises = availableExercises.filter((exerciseData) => {
      const { exercise } = exerciseData;

      // Check movement pattern match
      const patternMatch = split.movementPatterns.includes(
        exerciseData.movementPattern
      );

      // Check muscle group match
      const muscleMatch = split.primaryMuscles.some(
        (muscle) =>
          exercise.primaryMuscle.toString() === muscle ||
          exercise.primaryMuscle
            .toString()
            .toLowerCase()
            .includes(muscle.toLowerCase())
      );

      return patternMatch || muscleMatch;
    });

    // Sort by priority and similarity
    relevantExercises.sort((a, b) => {
      const priorityDiff = a.priority - b.priority;
      if (priorityDiff !== 0) return priorityDiff;

      return b.similarityScore - a.similarityScore;
    });

    // Select exercises ensuring variety and respecting the 5-8 limit
    const selected: ExerciseWithScore[] = [];
    const usedPatterns = new Set<string>();
    const usedMuscles = new Set<string>();

    // First pass: Select exercises with high priority and variety
    for (const exerciseData of relevantExercises) {
      if (selected.length >= split.exerciseCount) break;

      const { exercise } = exerciseData;
      const patternKey = exerciseData.movementPattern;
      const muscleKey = exercise.primaryMuscle.toString();

      // Prioritize variety in movement patterns and muscle groups
      const shouldAdd =
        selected.length < 3 || // Always add first 3 exercises
        !usedPatterns.has(patternKey) || // New movement pattern
        !usedMuscles.has(muscleKey) || // New muscle group
        usedPatterns.size < split.movementPatterns.length; // Need more pattern variety

      if (shouldAdd) {
        selected.push(exerciseData);
        usedPatterns.add(patternKey);
        usedMuscles.add(muscleKey);
      }
    }

    // Second pass: Fill remaining slots if we haven't reached the target
    if (selected.length < split.exerciseCount) {
      const remaining = relevantExercises.filter(
        (ex) => !selected.some((sel) => sel.exercise.id === ex.exercise.id)
      );

      // Add remaining exercises up to the limit
      const needed = split.exerciseCount - selected.length;
      selected.push(...remaining.slice(0, needed));
    }

    // Ensure we don't exceed the limit (safety check)
    if (selected.length > split.exerciseCount) {
      return selected.slice(0, split.exerciseCount);
    }

    return selected;
  }

  private generatePrescription(
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
      exercise.exerciseCategory === "cardio";

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
      if (exercise.equipment !== "body_weight" && baseWeight > 0) {
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
    } else if (exercise.exerciseCategory === "cardio") {
      return duration * 8; // 4-8 minutes for cardio
    }

    return duration;
  }

  /**
   * calc weight cần tác động
   * @param exercise
   * @param userProfile
   * @param goal
   * @returns
   */
  private calculateWeight(
    exercise: Exercise,
    userProfile: UserProfile,
    goal: Goal
  ): number {
    if (exercise.equipment === "body_weight") {
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

  private generateExerciseNote(
    exercise: Exercise,
    userProfile: UserProfile
  ): string {
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

  private calculateTotalDuration(planItems: PlanItem[]): number {
    return planItems.reduce((total, item) => {
      const { prescription } = item;

      let exerciseTime = 0;
      if (prescription.duration) {
        // Duration-based exercise
        exerciseTime = prescription.duration * prescription.sets;
      } else if (prescription.reps) {
        // Rep-based exercise (estimate 3 seconds per rep)
        exerciseTime = prescription.reps * 3 * prescription.sets;
      }

      // Add rest time between sets
      const restTime = prescription.restTime * (prescription.sets - 1);

      return total + exerciseTime + restTime;
    }, 0);
  }

  private calculateScheduledDate(
    dayIndex: number,
    sessionsPerWeek: number
  ): string {
    const today = new Date();

    // Tính khoảng cách giữa các buổi tập (có thể là số thập phân)
    const spacing = 7 / sessionsPerWeek;

    // Cộng số ngày dựa trên spacing
    const scheduledDate = new Date(today);
    scheduledDate.setDate(today.getDate() + Math.round(dayIndex * spacing));

    // Trả về chuỗi YYYY-MM-DD
    return scheduledDate.toISOString().split("T")[0];
  }

  /**
   * Generate an AI-suggested title for the workout plan based on user profile and goal
   * @param userProfile - User's fitness profile
   * @param goal - User's fitness goal
   * @param suggestedWeeks - Suggested duration in weeks
   * @returns string - AI-generated plan title
   */
  private generatePlanTitle(
    userProfile: UserProfile,
    goal: Goal,
    suggestedWeeks: number
  ): string {
    const fitnessLevel = userProfile.fitnessLevel;
    const objective = goal.objectiveType;
    const sessionsPerWeek = goal.sessionsPerWeek;
    const sessionMinutes = goal.sessionMinutes;

    // Create contextual title based on user profile and goals
    const titleTemplates = this.getTitleTemplates(fitnessLevel, objective);
    const selectedTemplate = this.selectBestTemplate(
      titleTemplates,
      userProfile,
      goal,
      suggestedWeeks
    );

    return this.customizeTitle(
      selectedTemplate,
      userProfile,
      goal,
      suggestedWeeks
    );
  }

  /**
   * Get title templates based on fitness level and objective
   */
  private getTitleTemplates(fitnessLevel: string, objective: string): string[] {
    const templates = {
      BEGINNER: {
        LOSE_FAT: [
          "Beginner's Fat Loss Journey",
          "Start Your Weight Loss Transformation",
          "Foundation Fat Burn Program",
          "Beginner's Weight Loss Challenge",
          "Your First Fat Loss Adventure",
        ],
        GAIN_MUSCLE: [
          "Beginner's Muscle Building Program",
          "Start Building Your Strength",
          "Foundation Muscle Growth Plan",
          "Your First Muscle Building Journey",
          "Beginner's Strength Development",
        ],
        ENDURANCE: [
          "Beginner's Endurance Builder",
          "Start Your Fitness Journey",
          "Foundation Cardio Program",
          "Beginner's Stamina Challenge",
          "Your First Endurance Adventure",
        ],
        MAINTAIN: [
          "Beginner's Wellness Program",
          "Start Your Healthy Lifestyle",
          "Foundation Fitness Plan",
          "Beginner's Health Journey",
          "Your First Wellness Program",
        ],
      },
      INTERMEDIATE: {
        LOSE_FAT: [
          "Advanced Fat Loss Transformation",
          "Intermediate Weight Loss Challenge",
          "Serious Fat Burn Program",
          "Intermediate Body Recomposition",
          "Advanced Weight Loss Journey",
        ],
        GAIN_MUSCLE: [
          "Intermediate Muscle Building Program",
          "Advanced Strength Development",
          "Serious Muscle Growth Plan",
          "Intermediate Hypertrophy Program",
          "Advanced Muscle Building Journey",
        ],
        ENDURANCE: [
          "Intermediate Endurance Challenge",
          "Advanced Cardio Program",
          "Serious Stamina Builder",
          "Intermediate Fitness Challenge",
          "Advanced Endurance Journey",
        ],
        MAINTAIN: [
          "Intermediate Wellness Program",
          "Advanced Health Maintenance",
          "Serious Fitness Plan",
          "Intermediate Lifestyle Program",
          "Advanced Wellness Journey",
        ],
      },
      ADVANCED: {
        LOSE_FAT: [
          "Elite Fat Loss Program",
          "Advanced Body Recomposition",
          "Expert Weight Loss Challenge",
          "Elite Fat Burn Transformation",
          "Advanced Fat Loss Mastery",
        ],
        GAIN_MUSCLE: [
          "Elite Muscle Building Program",
          "Advanced Hypertrophy Challenge",
          "Expert Strength Development",
          "Elite Muscle Growth Plan",
          "Advanced Muscle Mastery",
        ],
        ENDURANCE: [
          "Elite Endurance Program",
          "Advanced Cardio Challenge",
          "Expert Stamina Builder",
          "Elite Fitness Challenge",
          "Advanced Endurance Mastery",
        ],
        MAINTAIN: [
          "Elite Wellness Program",
          "Advanced Health Mastery",
          "Expert Fitness Plan",
          "Elite Lifestyle Program",
          "Advanced Wellness Mastery",
        ],
      },
    };

    return (
      (templates as any)[fitnessLevel]?.[objective] || [
        `${objective.replace("_", " ")} Training Program`,
        `${fitnessLevel} ${objective.replace("_", " ")} Program`,
        "Personalized Training Plan",
      ]
    );
  }

  /**
   * Select the best template based on user context
   */
  private selectBestTemplate(
    templates: string[],
    userProfile: UserProfile,
    goal: Goal,
    suggestedWeeks: number
  ): string {
    // Consider user's health status, age, and plan duration for template selection
    let selectedTemplate = templates[0]; // Default to first template

    // Health considerations
    if (userProfile.healthNote) {
      const healthNote = userProfile.healthNote.toLowerCase();
      if (healthNote.includes("knee") || healthNote.includes("back")) {
        // Choose more conservative titles
        selectedTemplate =
          templates.find(
            (t) =>
              t.toLowerCase().includes("foundation") ||
              t.toLowerCase().includes("start")
          ) || templates[0];
      }
    }

    // Plan duration considerations
    if (suggestedWeeks >= 10) {
      // Longer plans - choose more comprehensive titles
      selectedTemplate =
        templates.find(
          (t) =>
            t.toLowerCase().includes("journey") ||
            t.toLowerCase().includes("transformation") ||
            t.toLowerCase().includes("program")
        ) || templates[0];
    } else if (suggestedWeeks <= 6) {
      // Shorter plans - choose more focused titles
      selectedTemplate =
        templates.find(
          (t) =>
            t.toLowerCase().includes("challenge") ||
            t.toLowerCase().includes("start")
        ) || templates[0];
    }

    return selectedTemplate;
  }

  /**
   * Customize the selected template with user-specific details
   */
  private customizeTitle(
    template: string,
    userProfile: UserProfile,
    goal: Goal,
    suggestedWeeks: number
  ): string {
    let customizedTitle = template;

    // Add duration context for longer plans
    if (suggestedWeeks >= 12) {
      customizedTitle += ` (${suggestedWeeks}-Week Program)`;
    } else if (suggestedWeeks >= 8) {
      customizedTitle += ` (${suggestedWeeks}-Week Challenge)`;
    }

    // Add frequency context for specific cases
    if (goal.sessionsPerWeek <= 2) {
      customizedTitle += " - Low Frequency";
    } else if (goal.sessionsPerWeek >= 5) {
      customizedTitle += " - High Frequency";
    }

    // Add session duration context
    if (goal.sessionMinutes <= 30) {
      customizedTitle += " - Quick Sessions";
    } else if (goal.sessionMinutes >= 90) {
      customizedTitle += " - Extended Sessions";
    }

    return customizedTitle;
  }

  /**
   * Demo function to show how the AI title generation works
   * This can be used for testing and demonstration purposes
   */
  public demonstrateTitleGeneration(
    fitnessLevel: string,
    objective: string,
    sessionsPerWeek: number,
    sessionMinutes: number,
    suggestedWeeks: number,
    hasHealthIssues: boolean = false,
    age?: number
  ): {
    generatedTitle: string;
    templates: string[];
    selectedTemplate: string;
    customization: string;
  } {
    // Create mock objects for demonstration
    const mockProfile: Partial<UserProfile> = {
      fitnessLevel: fitnessLevel as any,
      healthNote: hasHealthIssues ? "knee problems" : undefined,
      age: age,
    };

    const mockGoal: Partial<Goal> = {
      objectiveType: objective as any,
      sessionsPerWeek,
      sessionMinutes,
    };

    const templates = this.getTitleTemplates(fitnessLevel, objective);
    const selectedTemplate = this.selectBestTemplate(
      templates,
      mockProfile as UserProfile,
      mockGoal as Goal,
      suggestedWeeks
    );
    const generatedTitle = this.customizeTitle(
      selectedTemplate,
      mockProfile as UserProfile,
      mockGoal as Goal,
      suggestedWeeks
    );

    let customization = "No customization applied";
    if (generatedTitle !== selectedTemplate) {
      const customizations = [];
      if (suggestedWeeks >= 12) customizations.push("Duration suffix");
      if (suggestedWeeks >= 8) customizations.push("Challenge suffix");
      if (sessionsPerWeek <= 2) customizations.push("Low frequency");
      if (sessionsPerWeek >= 5) customizations.push("High frequency");
      if (sessionMinutes <= 30) customizations.push("Quick sessions");
      if (sessionMinutes >= 90) customizations.push("Extended sessions");
      customization = customizations.join(", ");
    }

    return {
      generatedTitle,
      templates,
      selectedTemplate,
      customization,
    };
  }

  /**
   * Demo function to show how the suggested weeks calculation works
   * This can be used for testing and demonstration purposes
   */
  public demonstrateSuggestedWeeks(
    fitnessLevel: string,
    objective: string,
    sessionsPerWeek: number,
    sessionMinutes: number,
    hasHealthIssues: boolean = false,
    age?: number
  ): {
    baseWeeks: number;
    adjustments: number;
    finalWeeks: number;
    explanation: string;
  } {
    // Create mock objects for demonstration
    const mockProfile: Partial<UserProfile> = {
      fitnessLevel: fitnessLevel as any,
      healthNote: hasHealthIssues ? "knee problems" : undefined,
      age: age,
    };

    const mockGoal: Partial<Goal> = {
      objectiveType: objective as any,
      sessionsPerWeek,
      sessionMinutes,
    };

    const baseWeeks =
      WORKOUT_CONSTANTS.SUGGESTED_WEEKS[
        fitnessLevel as keyof typeof WORKOUT_CONSTANTS.SUGGESTED_WEEKS
      ][objective as keyof typeof WORKOUT_CONSTANTS.SUGGESTED_WEEKS.BEGINNER];
    const adjustments = this.calculateWeekAdjustments(
      mockProfile as UserProfile,
      mockGoal as Goal
    );
    const finalWeeks = baseWeeks + adjustments;

    let explanation = `Base weeks for ${fitnessLevel} ${objective}: ${baseWeeks}`;
    if (adjustments > 0) {
      explanation += `\n+${adjustments} weeks adjustments (health/session considerations)`;
    } else if (adjustments < 0) {
      explanation += `\n${adjustments} weeks adjustments (high frequency/long sessions)`;
    }
    explanation += `\nFinal suggested duration: ${finalWeeks} weeks`;

    return {
      baseWeeks,
      adjustments,
      finalWeeks,
      explanation,
    };
  }

  /**
   * Demo function to show how progressive overload works
   * This can be used for testing and demonstration purposes
   */
  public demonstrateProgressiveOverload(
    fitnessLevel: string,
    objective: string,
    totalWeeks: number
  ): {
    config: ProgressiveOverloadConfig;
    weeklyProgressions: WeeklyProgression[];
    explanation: string;
  } {
    const config = ProgressiveOverloadCalculator.createDefaultConfig(
      fitnessLevel as FitnessLevel,
      objective as Objective,
      totalWeeks
    );

    const weeklyProgressions: WeeklyProgression[] = [];

    for (let week = 1; week <= totalWeeks; week++) {
      const progression =
        ProgressiveOverloadCalculator.calculateWeeklyProgression(
          config,
          week,
          totalWeeks
        );
      weeklyProgressions.push(progression);
    }

    let explanation = `Progressive Overload Configuration for ${fitnessLevel} ${objective}:\n`;
    explanation += `Method: ${config.method}\n`;
    explanation += `Deload Frequency: Every ${config.deloadFrequency} weeks\n\n`;

    explanation += "Phases:\n";
    config.phases.forEach((phase, index) => {
      explanation += `${index + 1}. ${phase.phase.toUpperCase()} (${
        phase.duration
      } weeks)\n`;
      explanation += `   - Intensity: ${(
        phase.intensityMultiplier * 100
      ).toFixed(0)}%\n`;
      explanation += `   - Volume: ${(phase.volumeMultiplier * 100).toFixed(
        0
      )}%\n`;
      explanation += `   - Weight increase: ${phase.weightIncrease}kg/week\n`;
      explanation += `   - Reps adjustment: ${
        phase.repsAdjustment > 0 ? "+" : ""
      }${phase.repsAdjustment}\n`;
      explanation += `   - Sets adjustment: ${
        phase.setsAdjustment > 0 ? "+" : ""
      }${phase.setsAdjustment}\n\n`;
    });

    explanation += "Weekly Progression Summary:\n";
    const phaseSummary = weeklyProgressions.reduce((acc, progression) => {
      const phase = progression.phase;
      if (!acc[phase]) {
        acc[phase] = { weeks: 0, deloadWeeks: 0 };
      }
      acc[phase].weeks++;
      if (progression.isDeloadWeek) {
        acc[phase].deloadWeeks++;
      }
      return acc;
    }, {} as Record<string, { weeks: number; deloadWeeks: number }>);

    Object.entries(phaseSummary).forEach(([phase, summary]) => {
      explanation += `${phase.toUpperCase()}: ${summary.weeks} weeks`;
      if (summary.deloadWeeks > 0) {
        explanation += ` (${summary.deloadWeeks} deload weeks)`;
      }
      explanation += "\n";
    });

    return {
      config,
      weeklyProgressions,
      explanation,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
    await this.pgVectorService.close();
  }
}

export default new WorkoutPlanGeneratorService();
