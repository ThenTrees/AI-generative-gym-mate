import { mealPlanGenerator } from "./mealPlanGenerator.service";
import { Pool, types } from "pg";
import { PgVectorService } from "./pgVector.service";
import { DATABASE_CONFIG } from "../configs/database";
import { logger } from "../utils/logger";
import { PlanRequest } from "../types/request/planRequest";
import { Goal } from "../types/model/goal.model";
import { UserProfile } from "../types/model/userProfile.model";
import { FitnessLevel, Objective } from "../common/common-enum";
import { ExerciseWithScore } from "../types/model/exerciseWithScore";
import { PlanDay } from "../types/model/planDay.model";
import { PlanItem } from "../types/model/planItem.model";
import { IntensityLevel } from "../types/model/intensityLevel";
import { SessionStructure } from "../types/model/sessionStructure";
import { VolumeTargets } from "../types/model/volumeTargets";
import { RestPeriods } from "../types/model/restPeriods";
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
import { healthAnalysisService } from "./healthAnalysis.service";
import { planTitleService } from "./planTitle.service";
import { ExerciseSelectionService } from "./exerciseSelection.service";
import { workoutSplitService } from "./workoutSplit.service";
import { PrescriptionService } from "./prescription.service";

types.setTypeParser(1082, (val) => val);

class WorkoutPlanGeneratorService {
  private pool: Pool;
  private pgVectorService: PgVectorService;
  private workoutCalculator: WorkoutCalculator;
  private exerciseSelectionService: ExerciseSelectionService;
  private prescriptionService: PrescriptionService;

  constructor() {
    this.pool = new Pool(DATABASE_CONFIG);
    this.pgVectorService = new PgVectorService();
    this.workoutCalculator = new WorkoutCalculator();
    this.exerciseSelectionService = new ExerciseSelectionService(
      this.pgVectorService
    );
    this.prescriptionService = new PrescriptionService(this.workoutCalculator);
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
      const planStrategy = await this.analyzePlanRequirements(
        profile,
        goal,
        request
      );

      // Step 2: Find relevant exercises using RAG
      const selectedExercises =
        await this.exerciseSelectionService.selectExercisesUsingRAG(
          profile,
          goal,
          planStrategy
        );

      // Step 3: Calculate suggested weeks for the plan
      const suggestedWeeks = this.calculateSuggestedWeeks(profile, goal);

      // Step 4: Generate workout splits
      const workoutSplits = workoutSplitService.generateWorkoutSplits(
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
  private async analyzePlanRequirements(
    userProfile: UserProfile,
    goal: Goal,
    request: PlanRequest
  ): Promise<PlanStrategy> {
    const suggestedWeeks = this.calculateSuggestedWeeks(userProfile, goal);

    return {
      primaryObjective: goal.objectiveType,
      experienceLevel: userProfile.fitnessLevel,
      // based on goal -> strategy suitable for user.
      sessionStructure: this.determineSessionStructure(goal),
      equipmentPreferences: [], // TODO: update late
      // read field healthNote, if seen knee, back, shoulder problems -> warning
      specialConsiderations:
        await healthAnalysisService.analyzeHealthConsiderations(
          userProfile,
          request.notes
        ),
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

    console.log("baseVolume", baseVolume);

    return baseVolume;
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
      const aiGeneratedTitle = planTitleService.generatePlanTitle(
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
          const prescription = this.prescriptionService.generatePrescription(
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
              this.prescriptionService.generateExerciseNote(
                exerciseData.exercise,
                profile
              ),
              exerciseData.similarityScore,
            ]
          );

          planItems.push({
            exercise: exerciseData.exercise,
            itemIndex: itemIndex + 1,
            prescription,
            notes: this.prescriptionService.generateExerciseNote(
              exerciseData.exercise,
              profile
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

    const generatedTitle = planTitleService.generatePlanTitle(
      mockProfile as UserProfile,
      mockGoal as Goal,
      suggestedWeeks
    );

    // For demo purposes, we'll extract template info
    const templates: string[] = [];
    const selectedTemplate = generatedTitle.split(" (")[0]; // Remove suffix

    let customization = "No customization applied";
    if (generatedTitle !== selectedTemplate) {
      const customizations: string[] = [];
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
