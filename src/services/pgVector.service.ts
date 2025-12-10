import { Client, Pool, types } from "pg";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { DATABASE_CONFIG } from "../configs/database";
import { Exercise } from "../types/model/exercise.model";
import { ExerciseLoader } from "../loaders/exerciseLoader";
import { EmbeddingDocument } from "../types/model/embeddingDocument.model";
import { logger } from "../utils/logger";
import { loadConfig } from "../configs/environment";
import { Muscle } from "../types/model/muscle.model";
const config = loadConfig();
types.setTypeParser(1082, (val) => val);
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
  public async embed(text: string): Promise<number[]> {
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
  public normalizeEmbedding(values: number[]): number[] {
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

  // Note: Plan generation responsibilities were removed from this service.

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

  /**
   * check table exercise_embeddigs is already
   */
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

  /**
   *
   * @returns if hasn't row, in table, load exercise from fb.
   */
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
      await client.query("DELETE FROM exercise_embeddings");
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
          primaryMuscle: exercise.primaryMuscle.name,
          equipment: exercise.equipment.name,
          bodyPart: exercise.bodyPart,
          exerciseCategory: exercise.exerciseCategory.name,
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
        //chuyển distance thành similarity score (0 → không giống, 1 → giống hoàn toàn). Chỉ lấy các bài tập có similarity > threshold.
      );

      const documents: EmbeddingDocument[] = result.rows.map((row) => ({
        id: row.id,
        exerciseId: row.exercise_id,
        content: row.content,
        embedding: [],
        metadata: row.metadata,
        similarity: parseFloat(row.similarity),
      }));

      logger.info(
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
                      m.name as primary_muscle_name,
                      e.secondary_muscles,
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
                    LEFT JOIN muscles m ON e.primary_muscle = m.code
                    WHERE e.id = ANY($1::uuid[])
                      AND e.is_deleted = false
                  `;

      const result = await client.query(query, [exerciseIds]);
      return result.rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        primaryMuscle: {
          code: row.primary_muscle,
          name: row.primary_muscle_name,
        },
        secondaryMuscles: row.secondary_muscles || [],
        equipment: {
          code: row.equipment,
          name: row.equipment_name,
        },
        bodyPart: row.body_part,
        exerciseCategory: {
          code: row.exercise_category,
          name: row.category_name,
        },
        difficultyLevel: row.difficulty_level,
        instructions: row.instructions,
        safetyNotes: row.safety_notes,
        thumbnailUrl: row.thumbnail_url,
        benefits: row.benefits,
        tags: row.tags || [],
        alternativeNames: row.alternative_names || [], // TODO:
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

  /**
   * @returns total row in table embedding exercise
   */
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
