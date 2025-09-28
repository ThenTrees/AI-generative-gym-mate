import { Pool } from "pg";
import { PgVectorService } from "./pgVector.service";
import { DATABASE_CONFIG } from "../configs/database";
import { logger } from "../utils/logger";
import { PlanRequest } from "../types/request/planRequest";
import { Plan } from "../types/model/Plan.model";
import { Goal } from "../types/model/goal.model";
import { UserProfile } from "../types/model/userProfile.model";
import {
  FitnessLevel,
  Gender,
  Intensity,
  Objective,
} from "../common/common-enum";
import { ExerciseWithScore } from "../types/model/ExerciseWithScore";
import { Exercise } from "../types/model/exercise.model";
import { PlanDay } from "../types/model/planDay.model";
import { PlanItem } from "../types/model/planItem.model";
import { Prescription } from "../types/model/prescription";
import { PlanStrategy } from "../types/model/PlanStrategy";
import { IntensityLevel } from "../types/model/IntensityLevel";
import { WorkoutSplit } from "../types/model/WorkoutSplit";
import { SessionStructure } from "../types/model/SessionStructure";
import { HealthConsideration } from "../types/model/HealthConsideration";
import { VolumeTargets } from "../types/model/VolumeTargets";
import { RestPeriods } from "../types/model/RestPeriods";
import { SearchQuery } from "../types/model/SearchQuery";

class WorkoutPlanGeneratorService {
  private pool: Pool;
  private pgVectorService: PgVectorService;
  constructor() {
    this.pool = new Pool(DATABASE_CONFIG);
    this.pgVectorService = new PgVectorService();
  }
  async initialize(): Promise<void> {
    logger.info("Initializing Workout Plan Generator Service...");
    await this.pgVectorService.initialize();
    console.log("Workout Plan Generator Service ready");
  }

  async generateWorkoutPlan(request: PlanRequest): Promise<Plan> {
    logger.info(
      `[WorkoutPlanService] - Generating workout plan for user ${request.userId}`
    );
    const startTime = Date.now();
    try {
      // Step 1: Analyze user requirements and build search strategy
      const planStrategy = this.analyzePlanRequirements(request);

      // Step 2: Find relevant exercises using RAG
      const selectedExercises = await this.selectExercisesUsingRAG(
        request,
        planStrategy
      );

      // Step 3: Generate workout splits
      const workoutSplits = this.generateWorkoutSplits(request, planStrategy);

      // Step 4: Create plan structure in database
      const plan = await this.createPlanInDatabase(
        request,
        workoutSplits,
        selectedExercises
      );

      // Step 5: Generate detailed plan days and items
      const planDays = await this.generatePlanDays(
        plan,
        workoutSplits,
        selectedExercises,
        request
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
  private analyzePlanRequirements(request: PlanRequest): PlanStrategy {
    const { userProfile, goal } = request;
    return {
      primaryObjective: goal.objectiveType,
      experienceLevel: userProfile.fitnessLevel,
      // based on goal -> strategy suitable for user.
      sessionStructure: this.determineSessionStructure(goal),
      equipmentPreferences: [], // TODO:
      // read field healthNote, if seen knee, back, shoulder problems -> warning
      specialConsiderations: this.analyzeHealthConsiderations(userProfile),
      // check level fitness for user -> calc intensity suitable
      intensityLevel: this.calculateIntensityLevel(userProfile, goal),
      // set, rep suitable for user based on level and objective
      volumeTargets: this.calculateVolumeTargets(goal, userProfile),
    };
  }

  /**
   * choose structure suitable for user (based on session per week)
   * @param goal
   * @returns
   */
  private determineSessionStructure(goal: Goal): SessionStructure {
    const { sessionsPerWeek, sessionMinutes } = goal;

    if (sessionsPerWeek <= 2) {
      return {
        type: "full_body",
        exercisesPerSession: Math.floor(sessionMinutes / 8),
        splitStrategy: "minimal_frequency",
      };
    } else if (sessionsPerWeek <= 3) {
      return {
        type: "full_body_varied",
        exercisesPerSession: Math.floor(sessionMinutes / 7),
        splitStrategy: "moderate_frequency",
      };
    } else if (sessionsPerWeek <= 4) {
      return {
        type: "upper_lower",
        exercisesPerSession: Math.floor(sessionMinutes / 6),
        splitStrategy: "upper_lower_split",
      };
    } else {
      return {
        type: "body_part_split",
        exercisesPerSession: Math.floor(sessionMinutes / 5),
        splitStrategy: "high_frequency",
      };
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
        considerations.push({
          type: "joint_limitation",
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
          type: "joint_limitation",
          affectedArea: "shoulder",
          restrictions: ["overhead", "internal_rotation"],
          modifications: ["reduced_range", "stability_focus"],
        });
      }
    }

    if (considerations.length == 0) {
      logger.info("health for user very good!");
    }
    return considerations;
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
    let baseIntensity = 5; // Medium

    // Level adjustments, intensity = cường độ
    if (userProfile.fitnessLevel === FitnessLevel.BEGINNER) baseIntensity = 3;
    else if (userProfile.fitnessLevel === FitnessLevel.ADVANCED)
      baseIntensity = 7;

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
      compound: 120,
      isolation: 60,
      cardio: 30,
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
      baseTimes = { compound: 90, isolation: 45, cardio: 20 };
    } else if (objective === Objective.GAIN_MUSCLE) {
      baseTimes = { compound: 150, isolation: 90, cardio: baseTimes.cardio };
    }

    // Level adjustments
    if (level === FitnessLevel.BEGINNER) {
      baseTimes = addDelta(baseTimes, 30);
    } else if (level === FitnessLevel.ADVANCED) {
      baseTimes = subDelta(baseTimes, 15);
    }
    return baseTimes;
  }

  private calculateVolumeTargets(
    goal: Goal,
    userProfile: UserProfile
  ): VolumeTargets {
    const baseVolume: VolumeTargets = {
      setsPerMuscleGroup: 12,
      repsRange: [8, 12] as const,
      weeklyVolume: goal.sessionsPerWeek * goal.sessionMinutes,
    };

    // Objective adjustments
    switch (goal.objectiveType) {
      case Objective.GAIN_MUSCLE:
        baseVolume.setsPerMuscleGroup = 16;
        baseVolume.repsRange = [8, 12] as const;
        break;
      case Objective.LOSE_FAT:
        baseVolume.setsPerMuscleGroup = 10;
        baseVolume.repsRange = [12, 15] as const;
        break;
      case Objective.ENDURANCE:
        baseVolume.setsPerMuscleGroup = 8;
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
    request: PlanRequest,
    strategy: PlanStrategy
  ): Promise<ExerciseWithScore[]> {
    logger.info("Selecting exercises using RAG system...");

    // Build comprehensive search queries for different movement patterns
    const searchQueries = this.buildMovementPatternQueries(request, strategy);
    logger.info(`SearchQueries: ${JSON.stringify(searchQueries)}`);

    const allExercises: ExerciseWithScore[] = [];

    for (const query of searchQueries) {
      // TODO: log
      console.log(`query: ${JSON.stringify(query)}`);

      const results = await this.pgVectorService.similaritySearch(
        query.searchText,
        query.maxResults,
        0.3 // similarity threshold
      );

      const exerciseIds = results.map((r) => r.exerciseId);
      const exercises = await this.pgVectorService.getExercisesByIds(
        exerciseIds
      );
      // TODO: log
      console.log(`get exercise: ${JSON.stringify(exercises)}`);

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
    // TODO: log
    console.log(`uniqueExercises size: ${uniqueExercises.length}`);

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
    request: PlanRequest,
    strategy: PlanStrategy
  ): SearchQuery[] {
    const { userProfile, goal } = request;
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

      // Add health considerations
      for (const consideration of strategy.specialConsiderations) {
        if (
          consideration.affectedArea === "knee" &&
          pattern.pattern.includes("squat")
        ) {
          searchText += " knee safe low impact";
        }
        if (
          consideration.affectedArea === "spine" &&
          pattern.pattern.includes("hinge")
        ) {
          searchText += " back safe neutral spine";
        }
        if (
          consideration.affectedArea === "shoulder" &&
          pattern.pattern.includes("push")
        ) {
          searchText += " shoulder safe moderate range";
        }
      }

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
    if (consideration.type !== "joint_limitation") return false;

    const exerciseName = exercise.name.toLowerCase();
    const instructions = exercise.instructions?.toString()?.toLowerCase() || "";

    for (const restriction of consideration.restrictions) {
      switch (restriction) {
        case "high_impact":
          if (
            exerciseName.includes("jump") ||
            exerciseName.includes("plyometric")
          ) {
            return true;
          }
          break;
        case "deep_squat":
          if (
            exerciseName.includes("deep squat") ||
            exerciseName.includes("full squat")
          ) {
            return true;
          }
          break;
        case "overhead":
          if (
            exerciseName.includes("overhead") ||
            exerciseName.includes("military press")
          ) {
            return true;
          }
          break;
        case "spinal_flexion":
          if (
            exerciseName.includes("crunch") ||
            exerciseName.includes("sit-up")
          ) {
            return true;
          }
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
    request: PlanRequest,
    strategy: PlanStrategy
  ): WorkoutSplit[] {
    const { goal } = request;
    const splits: WorkoutSplit[] = [];

    switch (strategy.sessionStructure.type) {
      case "full_body":
        splits.push(
          ...this.generateFullBodySplits(goal.sessionsPerWeek, strategy)
        );
        break;
      case "full_body_varied":
        splits.push(
          ...this.generateVariedFullBodySplits(goal.sessionsPerWeek, strategy)
        );
        break;
      case "upper_lower":
        splits.push(
          ...this.generateUpperLowerSplits(goal.sessionsPerWeek, strategy)
        );
        break;
      case "body_part_split":
        splits.push(
          ...this.generateBodyPartSplits(goal.sessionsPerWeek, strategy)
        );
        break;
    }

    return splits;
  }

  private generateFullBodySplits(
    sessionsPerWeek: number,
    strategy: PlanStrategy
  ): WorkoutSplit[] {
    const splits: WorkoutSplit[] = [];

    for (let i = 0; i < sessionsPerWeek; i++) {
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

  private generateVariedFullBodySplits(
    sessionsPerWeek: number,
    strategy: PlanStrategy
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

    return splitVariations.slice(0, sessionsPerWeek).map((split, index) => ({
      ...split,
      focus: "full_body",
      exerciseCount: strategy.sessionStructure.exercisesPerSession,
      intensityLevel: strategy.intensityLevel.level,
    }));
  }

  private generateUpperLowerSplits(
    sessionsPerWeek: number,
    strategy: PlanStrategy
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
    for (let i = 0; i < sessionsPerWeek; i++) {
      splits.push(i % 2 === 0 ? upperSplit : lowerSplit);
    }

    return splits;
  }

  private generateBodyPartSplits(
    sessionsPerWeek: number,
    strategy: PlanStrategy
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

    return bodyPartSplits.slice(0, sessionsPerWeek).map((split) => ({
      ...split,
      exerciseCount: strategy.sessionStructure.exercisesPerSession,
      intensityLevel: strategy.intensityLevel.level,
    }));
  }

  private async createPlanInDatabase(
    request: PlanRequest,
    workoutSplits: WorkoutSplit[],
    exercises: ExerciseWithScore[]
  ): Promise<Plan> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      // Insert plan
      const planResult = await client.query(
        `
        INSERT INTO plans (user_id, goal_id, title, description, source, cycle_weeks, status, ai_metadata, generation_params)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `,
        [
          request.userId,
          request.goalId || null,
          `${request.goal.objectiveType.replace("_", " ")} Training Plan`,
          `${request.goal.sessionsPerWeek} sessions/week - ${request.goal.sessionMinutes} min/session`,
          "AI",
          4, // 4-week cycle
          "ACTIVE",
          JSON.stringify({
            totalExercises: exercises.length,
            avgSimilarityScore:
              exercises.reduce((sum, e) => sum + e.similarityScore, 0) /
              exercises.length,
            workoutSplits: workoutSplits.map((s) => s.name),
          }),
          JSON.stringify({
            userProfile: request.userProfile,
            goal: request.goal,
          }),
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
        createdAt: plan.created_at,
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
    request: PlanRequest
  ): Promise<PlanDay[]> {
    const client = await this.pool.connect();
    const planDays: PlanDay[] = [];

    try {
      await client.query("BEGIN");

      for (
        let dayIndex = 0;
        dayIndex < request.goal.sessionsPerWeek;
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
            this.calculateScheduledDate(dayIndex, request.goal.sessionsPerWeek),
          ]
        );

        const planDayRow = planDayResult.rows[0];

        // Select exercises for this split
        const selectedExercises = this.selectExercisesForSplit(
          split,
          exercises,
          request
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
            request.userProfile,
            request.goal,
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
              this.generateExerciseNote(
                exerciseData.exercise,
                request.userProfile
              ),
              exerciseData.similarityScore,
            ]
          );

          planItems.push({
            exercise: exerciseData.exercise,
            itemIndex: itemIndex + 1,
            prescription,
            note: this.generateExerciseNote(
              exerciseData.exercise,
              request.userProfile
            ),
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
    availableExercises: ExerciseWithScore[],
    request: PlanRequest
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

    // Select exercises ensuring variety
    const selected: ExerciseWithScore[] = [];
    const usedPatterns = new Set<string>();
    const usedMuscles = new Set<string>();

    for (const exerciseData of relevantExercises) {
      if (selected.length >= split.exerciseCount) break;

      const { exercise } = exerciseData;
      const patternKey = exerciseData.movementPattern;
      const muscleKey = exercise.primaryMuscle.toString();

      // Ensure pattern variety
      if (
        selected.length < 3 ||
        !usedPatterns.has(patternKey) ||
        usedPatterns.size < split.movementPatterns.length
      ) {
        selected.push(exerciseData);
        usedPatterns.add(patternKey);
        usedMuscles.add(muscleKey);
      }
    }

    // Fill remaining slots if needed
    if (selected.length < split.exerciseCount) {
      const remaining = relevantExercises.filter(
        (ex) => !selected.some((sel) => sel.exercise.id === ex.exercise.id)
      );
      selected.push(
        ...remaining.slice(0, split.exerciseCount - selected.length)
      );
    }

    return selected;
  }

  private generatePrescription(
    exercise: Exercise,
    userProfile: UserProfile,
    goal: Goal,
    split: WorkoutSplit
  ): Prescription {
    const baseReps = this.calculateReps(
      goal.objectiveType,
      userProfile.fitnessLevel,
      exercise
    );
    const baseSets = this.calculateSets(
      goal.objectiveType,
      userProfile.fitnessLevel,
      exercise
    );

    // Handle duration-based exercises
    const isDurationBased =
      exercise.name.toLowerCase().includes("plank") ||
      exercise.name.toLowerCase().includes("hold") ||
      exercise.exerciseCategory === "cardio";

    return {
      sets: baseSets,
      reps: isDurationBased ? undefined : baseReps,
      duration: isDurationBased
        ? this.calculateDuration(exercise, userProfile.fitnessLevel)
        : undefined,
      weight: this.calculateWeight(exercise, userProfile, goal),
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
    };
  }

  private calculateReps(
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
      exercise.exerciseCategory === "strength" &&
      exercise.name.toLowerCase().includes("deadlift")
    ) {
      baseReps = Math.max(5, baseReps - 5); // Heavy compounds lower reps
    }

    if (exercise.bodyPart === "waist") {
      baseReps += 5; // Core exercises typically higher reps
    }

    return Math.max(5, Math.min(30, baseReps));
  }

  private calculateSets(
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
    const scheduledDate = new Date(today);

    // Calculate optimal spacing between sessions
    const daysBetweenSessions = Math.floor(7 / sessionsPerWeek);
    scheduledDate.setDate(today.getDate() + dayIndex * daysBetweenSessions);

    return scheduledDate.toISOString().split("T")[0];
  }

  async close(): Promise<void> {
    await this.pool.end();
    await this.pgVectorService.close();
  }
}

export default new WorkoutPlanGeneratorService();
