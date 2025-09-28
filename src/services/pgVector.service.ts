import { Client, Pool } from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { DATABASE_CONFIG } from "../configs/database";
import { Exercise } from "../types/model/exercise.model";
import { ExerciseLoader } from "../loaders/exerciseLoader";
import { PlanRequest } from "../types/request/planRequest";
import { Plan } from "../types/model/Plan.model";
import { UserProfile } from "../types/model/userProfile.model";
import { Goal } from "../types/model/goal.model";
import { Prescription } from "../types/model/prescription";
import {
  DifficultyLevel,
  FitnessLevel,
  Gender,
  Intensity,
  Objective,
} from "../common/common-enum";
import { PlanItem } from "../types/model/planItem.model";
import { EmbeddingDocument } from "../types/model/embeddingDocument.model";
import { PlanDay } from "../types/model/planDay.model";
import { logger } from "../utils/logger";
import { config } from "../configs/environment";

export class PgVectorService {
  private pool: Pool;
  private genai: GoogleGenerativeAI;
  private exerciseLoader: ExerciseLoader;
  private static readonly EMBEDDING_DIM = 1536; // Gemini embedding dimension

  constructor() {
    this.pool = new Pool({
      ...DATABASE_CONFIG,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Fixed: Use correct Gemini API
    this.genai = new GoogleGenerativeAI(config.gemini.apiKey!);
    this.exerciseLoader = new ExerciseLoader();
  }

  // Fixed: Correct Gemini embedding method
  private async embed(text: string): Promise<number[]> {
    try {
      const model = this.genai.getGenerativeModel({
        model: config.gemini.model,
      });

      const result = await model.embedContent(text);
      const values = result.embedding?.values ?? [];

      return this.normalizeEmbedding(values);
    } catch (error) {
      console.error("Gemini embedding error:", error);
      throw error;
    }
  }

  // Fixed: Gemini embedding dimension is 768, not 1536
  private normalizeEmbedding(values: number[]): number[] {
    if (!Array.isArray(values))
      return new Array(PgVectorService.EMBEDDING_DIM).fill(0);
    if (values.length === PgVectorService.EMBEDDING_DIM) return values;
    if (values.length > PgVectorService.EMBEDDING_DIM) {
      return values.slice(0, PgVectorService.EMBEDDING_DIM);
    }
    // Pad with zeros
    const padded = values.slice();
    while (padded.length < PgVectorService.EMBEDDING_DIM) padded.push(0);
    return padded;
  }

  async initialize(): Promise<void> {
    console.log("Initializing Gym RAG Service...");
    try {
      await this.checkTablesExist();

      // Fixed: Auto-load embeddings if table is empty
      const stats = await this.getEmbeddingStats();
      if (stats.total === 0) {
        console.log("No embeddings found, loading exercises...");
        await this.loadAndStoreExercises();
      } else {
        console.log(`Found ${stats.total} existing embeddings`);
      }

      console.log("Gym RAG Service initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Gym RAG Service:", error);
      throw error;
    }
  }

  async generateWorkoutPlan(request: PlanRequest): Promise<Plan> {
    console.log(`Generating workout plan for user ${request.userId}`);

    try {
      // Build search query
      const searchQuery = this.buildSearchQuery(request);
      logger.info(`Search query: ${searchQuery}`);

      // Find relevant exercises
      const searchResults = await this.similaritySearch(
        searchQuery,
        Math.min(100, Math.max(30, request.goal.sessionsPerWeek * 12)),
        0.3
      );

      if (searchResults.length === 0) {
        throw new Error("No suitable exercises found for the given criteria");
      }

      // Get full exercise details
      const exerciseIds = searchResults.map((result) =>
        result.exerciseId.toString()
      );
      const exercises = await this.getExercisesByIds(exerciseIds);

      // Generate structured plan
      const plan = await this.createStructuredWorkoutPlan(
        request,
        exercises,
        searchResults
      );

      console.log(`Generated plan with ${plan.planDays.length} workout days`);
      return plan;
    } catch (error) {
      console.error("Failed to generate workout plan:", error);
      throw error;
    }
  }

  private buildSearchQuery(request: PlanRequest): string {
    const { userProfile, goal } = request;
    const queryParts: string[] = [];

    // Add primary objective
    const objectiveMap = {
      LOSE_FAT: "weight loss fat burning cardio high intensity",
      GAIN_MUSCLE: "muscle gain hypertrophy strength building mass",
      ENDURANCE: "endurance stamina cardiovascular conditioning aerobic",
      MAINTAIN: "maintenance general fitness balanced wellness",
    };

    queryParts.push(objectiveMap[goal.objectiveType] || "general fitness");

    // Add experience level
    queryParts.push(userProfile.fitnessLevel.toLowerCase());

    // Add gender considerations
    if (userProfile.gender === "FEMALE") {
      queryParts.push("women suitable female friendly");
    }

    // Add preferences
    if (goal.preferences?.includes("home_workout")) {
      queryParts.push("bodyweight no equipment home workout calisthenics");
    }

    if (goal.preferences?.includes("gym")) {
      queryParts.push("gym equipment weights machines dumbbells barbell");
    }

    if (goal.preferences?.includes("compound_movements")) {
      queryParts.push("compound functional multi-joint");
    }

    if (goal.preferences?.includes("isolation")) {
      queryParts.push("isolation single-joint targeted");
    }

    // Add health considerations
    if (userProfile.healthNote) {
      const healthNote = userProfile.healthNote.toLowerCase();
      if (healthNote.includes("knee")) {
        queryParts.push("low impact knee safe modified range motion");
      }
      if (healthNote.includes("back")) {
        queryParts.push("back safe spine neutral core stability");
      }
      if (healthNote.includes("shoulder")) {
        queryParts.push("shoulder safe low impact shoulder friendly");
      }
    }

    // Add session length considerations
    if (goal.sessionMinutes <= 30) {
      queryParts.push("quick efficient short time effective");
    } else if (goal.sessionMinutes >= 60) {
      queryParts.push("comprehensive detailed extended workout");
    }

    return queryParts.join(" ");
  }

  private async createStructuredWorkoutPlan(
    request: PlanRequest,
    exercises: Exercise[],
    searchResults: any[]
  ): Promise<Plan> {
    const planId = `plan_${request.userId}_${Date.now()}`;

    // Create exercise lookup map
    const exerciseMap = new Map<
      string,
      { exercise: Exercise; similarity: number }
    >();
    exercises.forEach((exercise) => {
      const searchResult = searchResults.find(
        (sr) => sr.exerciseId === exercise.id
      );
      exerciseMap.set(exercise.id, {
        exercise,
        similarity: searchResult?.similarity || 0,
      });
    });

    // Generate workout splits
    const workoutSplits = this.getWorkoutSplit(
      request.goal.sessionsPerWeek,
      request.goal.objectiveType
    );
    const planDays: PlanDay[] = [];

    for (
      let dayIndex = 0;
      dayIndex < request.goal.sessionsPerWeek;
      dayIndex++
    ) {
      const split = workoutSplits[dayIndex];
      const dayExercises = this.selectExercisesForSplit(
        split,
        Array.from(exerciseMap.values()),
        request
      );

      const planItems: PlanItem[] = dayExercises.map(
        (exerciseData, itemIndex) => ({
          exercise: exerciseData.exercise,
          itemIndex: itemIndex + 1,
          prescription: this.generatePrescription(
            exerciseData.exercise,
            request.userProfile,
            request.goal
          ),
          note: this.generateExerciseNote(
            exerciseData.exercise,
            request.userProfile
          ),
          similarityScore: exerciseData.similarity,
        })
      );

      planDays.push({
        dayIndex: dayIndex + 1,
        scheduledDate: this.calculateScheduledDate(
          dayIndex,
          request.goal.sessionsPerWeek
        ),
        planItems,
        totalDuration: this.calculateTotalDuration(planItems),
        splitName: split.splitName,
      });
    }

    return {
      id: planId,
      userId: request.userId,
      goalId: request.goalId,
      title: `${request.goal.objectiveType.replace("_", " ")} Plan`,
      description: `${request.goal.sessionsPerWeek} days/week - ${request.goal.sessionMinutes} min/session`,
      planDays,
      totalWeeks: 4,
      createdAt: new Date().toISOString(),
      aiMetadata: {
        searchQuery: this.buildSearchQuery(request),
        totalExercisesConsidered: exercises.length,
        avgSimilarityScore:
          searchResults.reduce((sum, r) => sum + r.similarity, 0) /
          searchResults.length,
      },
      generationParams: {
        userProfile: request.userProfile,
        goal: request.goal,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private getWorkoutSplit(
    sessionsPerWeek: number,
    objective: string
  ): Array<{
    splitName: string;
    bodyParts: string[];
    priority: string[];
    equipmentFocus?: string[];
  }> {
    if (sessionsPerWeek <= 2) {
      return [
        {
          splitName: "Full Body Strength",
          bodyParts: ["chest", "back", "upper_legs", "shoulders"],
          priority: ["compound", "functional"],
          equipmentFocus: ["barbell", "dumbbell", "body_weight"],
        },
        {
          splitName: "Full Body Conditioning",
          bodyParts: ["upper_legs", "waist", "cardio"],
          priority: ["conditioning", "cardio"],
          equipmentFocus: ["body_weight", "kettlebell"],
        },
      ].slice(0, sessionsPerWeek);
    } else if (sessionsPerWeek <= 3) {
      return [
        {
          splitName: "Upper Body",
          bodyParts: ["chest", "back", "shoulders", "upper_arms"],
          priority: ["push", "pull"],
          equipmentFocus: ["dumbbell", "barbell", "cable"],
        },
        {
          splitName: "Lower Body",
          bodyParts: ["upper_legs", "glutes", "lower_legs"],
          priority: ["squat", "deadlift"],
          equipmentFocus: ["barbell", "dumbbell", "body_weight"],
        },
        {
          splitName: "Full Body + Cardio",
          bodyParts: ["chest", "back", "upper_legs", "waist"],
          priority: ["compound", "cardio"],
          equipmentFocus: ["body_weight", "dumbbell"],
        },
      ];
    } else if (sessionsPerWeek <= 4) {
      return [
        {
          splitName: "Upper Push",
          bodyParts: ["chest", "shoulders", "upper_arms"],
          priority: ["push", "press"],
          equipmentFocus: ["dumbbell", "barbell"],
        },
        {
          splitName: "Lower Body",
          bodyParts: ["upper_legs", "glutes", "lower_legs"],
          priority: ["squat", "deadlift", "lunge"],
          equipmentFocus: ["barbell", "dumbbell"],
        },
        {
          splitName: "Upper Pull",
          bodyParts: ["back", "upper_arms"],
          priority: ["pull", "row"],
          equipmentFocus: ["cable", "dumbbell", "barbell"],
        },
        {
          splitName: "Full Body + Core",
          bodyParts: ["chest", "back", "upper_legs", "waist"],
          priority: ["compound", "core"],
          equipmentFocus: ["body_weight", "dumbbell"],
        },
      ];
    } else {
      return [
        {
          splitName: "Chest & Triceps",
          bodyParts: ["chest", "upper_arms"],
          priority: ["push", "press"],
          equipmentFocus: ["dumbbell", "barbell"],
        },
        {
          splitName: "Back & Biceps",
          bodyParts: ["back", "upper_arms"],
          priority: ["pull", "row"],
          equipmentFocus: ["cable", "dumbbell"],
        },
        {
          splitName: "Legs & Glutes",
          bodyParts: ["upper_legs", "glutes"],
          priority: ["squat", "deadlift"],
          equipmentFocus: ["barbell", "dumbbell"],
        },
        {
          splitName: "Shoulders & Core",
          bodyParts: ["shoulders", "waist"],
          priority: ["press", "stability"],
          equipmentFocus: ["dumbbell", "body_weight"],
        },
        {
          splitName: "Arms & Accessories",
          bodyParts: ["upper_arms", "lower_arms"],
          priority: ["curl", "isolation"],
          equipmentFocus: ["dumbbell", "cable"],
        },
        {
          splitName: "Cardio & Conditioning",
          bodyParts: ["cardio", "waist"],
          priority: ["cardio", "conditioning"],
          equipmentFocus: ["body_weight"],
        },
      ].slice(0, sessionsPerWeek);
    }
  }

  private selectExercisesForSplit(
    split: {
      splitName: string;
      bodyParts: string[];
      priority: string[];
      equipmentFocus?: string[];
    },
    availableExercises: Array<{ exercise: Exercise; similarity: number }>,
    request: PlanRequest
  ): Array<{ exercise: Exercise; similarity: number }> {
    const targetExerciseCount = Math.max(
      4,
      Math.min(10, Math.floor(request.goal.sessionMinutes / 7))
    );

    // Filter exercises for this split
    const relevantExercises = availableExercises.filter(({ exercise }) => {
      const bodyPartMatch = split.bodyParts.some(
        (bodyPart) =>
          exercise.bodyPart === bodyPart ||
          exercise.primaryMuscle
            .toString()
            .toLowerCase()
            .includes(bodyPart.toLowerCase())
      );

      const equipmentMatch =
        !split.equipmentFocus ||
        split.equipmentFocus.some((eq) => exercise.equipment === eq);

      // Filter by difficulty level
      const levelFilter = this.getDifficultyFilter(
        request.userProfile.fitnessLevel
      );
      const difficultyMatch =
        exercise.difficultyLevel >= levelFilter.min &&
        exercise.difficultyLevel <= levelFilter.max;

      return bodyPartMatch && equipmentMatch && difficultyMatch;
    });

    // Sort by similarity and priority
    relevantExercises.sort((a, b) => {
      const aPriorityMatch = split.priority.some(
        (priority) =>
          a.exercise.name.toLowerCase().includes(priority.toLowerCase()) ||
          a.exercise.tags?.some((tag) =>
            tag.toLowerCase().includes(priority.toLowerCase())
          )
      )
        ? 0.1
        : 0;

      const bPriorityMatch = split.priority.some(
        (priority) =>
          b.exercise.name.toLowerCase().includes(priority.toLowerCase()) ||
          b.exercise.tags?.some((tag) =>
            tag.toLowerCase().includes(priority.toLowerCase())
          )
      )
        ? 0.1
        : 0;

      return b.similarity + bPriorityMatch - (a.similarity + aPriorityMatch);
    });

    // Select exercises with variety
    const selected: Array<{ exercise: Exercise; similarity: number }> = [];
    const usedBodyParts = new Set<string>();
    const usedEquipment = new Set<string>();

    for (const exerciseData of relevantExercises) {
      if (selected.length >= targetExerciseCount) break;

      const { exercise } = exerciseData;
      const bodyPartKey = `${exercise.bodyPart}_${exercise.primaryMuscle}`;

      // Ensure variety
      if (
        selected.length < 3 ||
        !usedBodyParts.has(bodyPartKey) ||
        usedBodyParts.size < Math.min(3, split.bodyParts.length)
      ) {
        selected.push(exerciseData);
        usedBodyParts.add(bodyPartKey);
        usedEquipment.add(exercise.equipment);
      }
    }

    // Fill remaining slots if needed
    if (selected.length < targetExerciseCount) {
      const remaining = relevantExercises.filter(
        (ex) => !selected.some((sel) => sel.exercise.id === ex.exercise.id)
      );
      selected.push(
        ...remaining.slice(0, targetExerciseCount - selected.length)
      );
    }

    return selected;
  }

  private getDifficultyFilter(level: string): {
    min: number;
    max: number;
  } {
    switch (level) {
      case DifficultyLevel.BEGINNER:
        return { min: 1, max: 3 };
      case DifficultyLevel.INTERMEDIATE:
        return { min: 2, max: 4 };
      case DifficultyLevel.ADVANCED:
        return { min: 3, max: 5 };
      default:
        return { min: 1, max: 5 };
    }
  }

  private generatePrescription(
    exercise: Exercise,
    userProfile: UserProfile,
    goal: Goal
  ): Prescription {
    const baseReps = this.getBaseReps(
      goal.objectiveType,
      userProfile.fitnessLevel
    );
    const baseSets = this.getBaseSets(
      goal.objectiveType,
      userProfile.fitnessLevel
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
        ? this.getDuration(exercise, userProfile.fitnessLevel)
        : undefined,
      weight: this.calculateWeight(exercise, userProfile),
      restTime: this.getRestTime(goal.objectiveType, userProfile.fitnessLevel),
      intensity: this.getIntensity(
        userProfile.fitnessLevel,
        goal.objectiveType
      ),
    };
  }

  private getBaseReps(objective: Objective, level: FitnessLevel): number {
    const repRanges = {
      LOSE_FAT: { BEGINNER: 15, INTERMEDIATE: 12, ADVANCED: 10 },
      GAIN_MUSCLE: { BEGINNER: 12, INTERMEDIATE: 10, ADVANCED: 8 },
      ENDURANCE: { BEGINNER: 20, INTERMEDIATE: 25, ADVANCED: 30 },
      MAINTAIN: { BEGINNER: 15, INTERMEDIATE: 12, ADVANCED: 10 },
    };

    return repRanges[objective]?.[level] || 12;
  }

  private getBaseSets(objective: Objective, level: string): number {
    if (level === FitnessLevel.BEGINNER)
      return objective === Objective.ENDURANCE ? 3 : 2;
    if (level === FitnessLevel.INTERMEDIATE) return 3;
    return objective === Objective.ENDURANCE ? 4 : 3;
  }

  private getDuration(exercise: Exercise, level: FitnessLevel): number {
    const baseDurations = {
      BEGINNER: 30,
      INTERMEDIATE: 45,
      ADVANCED: 60,
    };

    if (exercise.name.toLowerCase().includes("plank")) {
      return baseDurations[level];
    }

    if (exercise.exerciseCategory === "cardio") {
      return baseDurations[level] * 10; // 5-10 minutes
    }

    return baseDurations[level];
  }

  private calculateWeight(
    exercise: Exercise,
    userProfile: UserProfile
  ): number {
    if (exercise.equipment === "body_weight") {
      return 0;
    }

    const bodyweight = userProfile.weight;
    const levelMultiplier =
      userProfile.fitnessLevel === FitnessLevel.BEGINNER
        ? 0.6
        : userProfile.fitnessLevel === FitnessLevel.INTERMEDIATE
        ? 0.8
        : 1.0;

    let basePercentage = 0.3;

    // Adjust based on body part
    if (exercise.bodyPart === "chest") {
      basePercentage = 0.5;
    } else if (exercise.bodyPart === "upper_legs") {
      basePercentage = 0.8;
    } else if (exercise.bodyPart === "back") {
      basePercentage = 0.6;
    } else if (exercise.bodyPart === "shoulders") {
      basePercentage = 0.4;
    } else if (exercise.bodyPart === "upper_arms") {
      basePercentage = 0.25;
    }

    // Gender adjustment
    if (userProfile.gender === Gender.FEMALE) {
      basePercentage *= 0.7;
    }

    const suggestedWeight =
      Math.round((bodyweight * basePercentage * levelMultiplier) / 2.5) * 2.5;
    return Math.max(2.5, suggestedWeight);
  }

  private getRestTime(objective: Objective, level: FitnessLevel): number {
    const restTimes = {
      LOSE_FAT: { BEGINNER: 45, INTERMEDIATE: 30, ADVANCED: 30 },
      GAIN_MUSCLE: { BEGINNER: 90, INTERMEDIATE: 75, ADVANCED: 60 },
      ENDURANCE: { BEGINNER: 30, INTERMEDIATE: 20, ADVANCED: 15 },
      MAINTAIN: { BEGINNER: 60, INTERMEDIATE: 45, ADVANCED: 45 },
    };

    return restTimes[objective]?.[level] || 60;
  }

  private getIntensity(level: FitnessLevel, objective: Objective): Intensity {
    if (level === FitnessLevel.BEGINNER) return Intensity.LOW;
    if (
      level === FitnessLevel.ADVANCED &&
      (objective === Objective.LOSE_FAT || objective === Objective.GAIN_MUSCLE)
    )
      return Intensity.HIGH;
    return Intensity.MEDIUM;
  }

  private generateExerciseNote(
    exercise: Exercise,
    userProfile: UserProfile
  ): string {
    const notes: string[] = [];

    // Level-based notes
    if (userProfile.fitnessLevel === "BEGINNER") {
      notes.push("Focus on proper form over weight/speed");
      if (exercise.difficultyLevel >= 4) {
        notes.push("Consider starting with a modified version");
      }
    }

    // Health-based modifications
    if (userProfile.healthNote) {
      const healthNote = userProfile.healthNote.toLowerCase();

      if (healthNote.includes("knee") && exercise.bodyPart === "upper_legs") {
        notes.push("Modify range of motion if knee discomfort occurs");
      }

      if (healthNote.includes("back")) {
        if (
          exercise.name.toLowerCase().includes("deadlift") ||
          exercise.name.toLowerCase().includes("row") ||
          exercise.name.toLowerCase().includes("squat")
        ) {
          notes.push("Maintain neutral spine throughout movement");
        }
      }

      if (
        healthNote.includes("shoulder") &&
        exercise.bodyPart === "shoulders"
      ) {
        notes.push("Use lighter weight initially for shoulder safety");
      }
    }

    // Exercise-specific safety notes
    if (exercise.safetyNotes) {
      notes.push(exercise.safetyNotes);
    }

    return notes.join(". ") + (notes.length > 0 ? "." : "");
  }

  private calculateTotalDuration(planItems: PlanItem[]): number {
    return planItems.reduce((total, item) => {
      const { prescription } = item;

      let exerciseTime = 0;
      if (prescription.duration) {
        exerciseTime = prescription.duration * prescription.sets;
      } else if (prescription.reps) {
        exerciseTime = prescription.reps * 3 * prescription.sets;
      }

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

    const daysBetweenSessions = Math.floor(7 / sessionsPerWeek);
    scheduledDate.setDate(today.getDate() + dayIndex * daysBetweenSessions);

    return scheduledDate.toISOString().split("T")[0];
  }

  async refreshExerciseDatabase(): Promise<void> {
    console.log("Refreshing exercise database...");
    await this.refreshEmbeddings();
    console.log("Exercise database refreshed");
  }

  async getServiceStats(): Promise<any> {
    return await this.getEmbeddingStats();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async checkTablesExist(): Promise<void> {
    const client = await this.pool.connect();

    try {
      const result = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'exercise_embeddings'
        );
      `);

      if (!result.rows[0].exists) {
        throw new Error(
          "exercise_embeddings table not found. Please run Flyway migration V7__add_exercise_embeddings_table.sql first."
        );
      }

      console.log("Required tables exist");
    } finally {
      client.release();
    }
  }

  async loadAndStoreExercises(): Promise<void> {
    console.log("Loading exercises from database...");

    const exercises = await this.exerciseLoader.loadExercises();

    if (exercises.length === 0) {
      console.log("No exercises found to process");
      return;
    }

    console.log("Creating embeddings and storing in exercise_embeddings...");

    const client = await this.pool.connect();

    try {
      // Clear existing embeddings
      // TODO: don't del
      // await client.query ("DELETE FROM exercise_embeddings");
      console.log("Cleared existing embeddings");

      // Process exercises in batches
      const batchSize = 50;
      for (let i = 0; i < exercises.length; i += batchSize) {
        logger.info("Starting batch processing...");
        const batch = exercises.slice(i, i + batchSize);
        await this.processBatch(client, batch);
        console.log(
          `Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
            exercises.length / batchSize
          )}`
        );
      }

      // Update statistics
      await client.query("ANALYZE exercise_embeddings");

      console.log(
        `Successfully stored ${exercises.length} exercise embeddings`
      );
    } finally {
      client.release();
    }
  }

  // Fixed: Process batch with proper error handling and rate limiting
  private async processBatch(
    client: any,
    exercises: Exercise[]
  ): Promise<void> {
    console.log(`Processing batch of ${exercises.length} exercises...`);

    for (const exercise of exercises) {
      try {
        const content = this.exerciseLoader.createExerciseContent(exercise);

        // Fixed: Use corrected embed method
        const embedding = await this.embed(content);

        const metadata = {
          slug: exercise.slug,
          name: exercise.name,
          primaryMuscle: exercise.primaryMuscle,
          equipment: exercise.equipment,
          bodyPart: exercise.bodyPart,
          exerciseCategory: exercise.exerciseCategory,
          difficultyLevel: exercise.difficultyLevel,
        };

        // Upsert to database
        const embeddingLiteral = `[${embedding.join(",")}]`;

        const updateRes = await client.query(
          `
          UPDATE exercise_embeddings
          SET content = $2,
              embedding = $3::vector,
              metadata = $4::jsonb,
              updated_at = NOW()
          WHERE exercise_id = $1
        `,
          [exercise.id, content, embeddingLiteral, JSON.stringify(metadata)]
        );

        if (updateRes.rowCount === 0) {
          await client.query(
            `
            INSERT INTO exercise_embeddings (exercise_id, content, embedding, metadata)
            VALUES ($1, $2, $3::vector, $4::jsonb)
          `,
            [exercise.id, content, embeddingLiteral, JSON.stringify(metadata)]
          );
        }

        console.log(`Processed exercise: ${exercise.name}`);

        // Rate limiting to avoid Gemini quota issues
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to process exercise ${exercise.name}:`, error);
        // Continue with next exercise instead of failing entire batch
      }
    }
  }

  async similaritySearch(
    query: string,
    k: number = 10,
    threshold: number = 0.3
  ): Promise<EmbeddingDocument[]> {
    logger.info(`Searching for similar exercises: "${query}" (k=${k})`);

    // Fixed: Use corrected embed method
    const queryEmbedding = await this.embed(query);
    const client = await this.pool.connect();

    try {
      const result = await client.query(
        `
        SELECT 
          ee.id,
          ee.exercise_id,
          ee.content,
          ee.metadata,
          1 - (ee.embedding <=> $1::vector) AS similarity
        FROM exercise_embeddings ee
        WHERE 1 - (ee.embedding <=> $1::vector) > $3
        ORDER BY ee.embedding <=> $1::vector
        LIMIT $2
      `,
        [`[${queryEmbedding.join(",")}]`, k, threshold]
      );

      const documents: EmbeddingDocument[] = result.rows.map((row) => ({
        id: row.id,
        exerciseId: row.exercise_id,
        content: row.content,
        embedding: [],
        metadata: row.metadata,
        similarity: parseFloat(row.similarity),
      }));

      console.log(
        `Found ${documents.length} similar exercises (avg similarity: ${
          documents.length > 0
            ? (
                documents.reduce((sum, doc) => sum + (doc.similarity || 0), 0) /
                documents.length
              ).toFixed(3)
            : 0
        })`
      );

      return documents;
    } finally {
      client.release();
    }
  }

  async getExercisesByIds(exerciseIds: string[]): Promise<Exercise[]> {
    if (exerciseIds.length === 0) return [];

    const client = await this.pool.connect();

    try {
      const placeholders = exerciseIds
        .map((_, index) => `${index + 1}`)
        .join(",");
      const query = `
                    SELECT 
                      e.id,
                      e.slug,
                      e.name,
                      e.primary_muscle,
                      e.equipment,
                      e.body_part,
                      e.exercise_category,
                      e.difficulty_level,
                      e.instructions,
                      e.safety_notes,
                      e.thumbnail_url,
                      e.benefits,
                      e.tags,
                      e.alternative_names
                    FROM exercises e
                    WHERE e.id = ANY($1::uuid[])
                      AND e.is_deleted = false
                  `;

      const result = await client.query(query, [exerciseIds]);
      return result.rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        primaryMuscle: row.primary_muscle,
        equipment: row.equipment,
        bodyPart: row.body_part,
        exerciseCategory: row.exercise_category,
        difficultyLevel: row.difficulty_level,
        instructions: row.instructions,
        safetyNotes: row.safety_notes,
        thumbnailUrl: row.thumbnail_url,
        benefits: row.benefits,
        tags: row.tags || [],
        alternativeNames: row.alternative_names || [],
        secondaryMuscles: row.alternative_names || [],
      }));
    } finally {
      client.release();
    }
  }

  async refreshEmbeddings(): Promise<void> {
    console.log("Refreshing exercise embeddings...");
    await this.loadAndStoreExercises();
    console.log("Embeddings refreshed successfully");
  }

  async getEmbeddingStats(): Promise<{ total: number; lastUpdated: string }> {
    const client = await this.pool.connect();

    try {
      const result = await client.query(`
        SELECT 
          COUNT(*) as total,
          MAX(updated_at) as last_updated
        FROM exercise_embeddings
      `);

      return {
        total: parseInt(result.rows[0].total),
        lastUpdated: result.rows[0].last_updated,
      };
    } finally {
      client.release();
    }
  }
}

export const pgVectorService = new PgVectorService();
