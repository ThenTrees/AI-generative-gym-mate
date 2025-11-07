import { Pool } from "pg";
import { DATABASE_CONFIG } from "../configs/database";
import { PgVectorService } from "./pgVector.service";
import { logger } from "../utils/logger";
import knowledgeBase from "./knowledgeBase.service";

export interface KnowledgeDocument {
  id: string;
  knowledgeId: string;
  category: string;
  subcategory: string;
  content: string;
  metadata: Record<string, any>;
  similarity?: number;
}

export class KnowledgeVectorService {
  private pool: Pool;
  private pgVector: PgVectorService;

  constructor() {
    this.pool = new Pool({
      ...DATABASE_CONFIG,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    this.pgVector = new PgVectorService();
  }

  /**
   * Check if knowledge_embeddings table exists
   */
  async checkTableExists(): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'knowledge_embeddings'
        );
      `);
      return result.rows[0].exists;
    } finally {
      client.release();
    }
  }

  /**
   * Load tất cả knowledge từ knowledgeBase service và convert sang embeddings
   */
  async loadAndStoreKnowledge(): Promise<void> {
    logger.info("Loading knowledge base and creating embeddings...");

    // Check if table exists
    const tableExists = await this.checkTableExists();
    if (!tableExists) {
      logger.error("knowledge_embeddings table does not exist. Please run migration first.");
      throw new Error("knowledge_embeddings table not found");
    }

    const client = await this.pool.connect();

    try {
      // Get all knowledge từ knowledgeBase service
      const allKnowledge = this.getAllKnowledgeFromService();

      if (allKnowledge.length === 0) {
        logger.warn("No knowledge items found to process");
        return;
      }

      logger.info(`Processing ${allKnowledge.length} knowledge items...`);

      // Process in batches
      const batchSize = 20;
      for (let i = 0; i < allKnowledge.length; i += batchSize) {
        const batch = allKnowledge.slice(i, i + batchSize);
        await this.processBatch(client, batch);
        logger.info(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allKnowledge.length / batchSize)}`);
      }

      await client.query("ANALYZE knowledge_embeddings");
      logger.info(`✅ Successfully stored ${allKnowledge.length} knowledge embeddings`);
    } finally {
      client.release();
    }
  }

  /**
   * Extract tất cả knowledge từ knowledgeBase service
   */
  private getAllKnowledgeFromService(): Array<{
    knowledgeId: string;
    category: string;
    subcategory: string;
    content: string;
  }> {
    const allKnowledge: Array<{
      knowledgeId: string;
      category: string;
      subcategory: string;
      content: string;
    }> = [];

    // Access private properties using type assertion
    const kbService = knowledgeBase as any;

    // Get exercise knowledge
    const exerciseKnowledge = kbService.exerciseKnowledge || {};
    Object.entries(exerciseKnowledge).forEach(([subcategory, items]: [string, any]) => {
      if (Array.isArray(items)) {
        items.forEach((item: string, index: number) => {
          allKnowledge.push({
            knowledgeId: `exercise_${subcategory}_${index}`,
            category: 'exercise',
            subcategory,
            content: item
          });
        });
      }
    });

    // Get nutrition knowledge
    const nutritionKnowledge = kbService.nutritionKnowledge || {};
    Object.entries(nutritionKnowledge).forEach(([subcategory, items]: [string, any]) => {
      if (Array.isArray(items)) {
        items.forEach((item: string, index: number) => {
          allKnowledge.push({
            knowledgeId: `nutrition_${subcategory}_${index}`,
            category: 'nutrition',
            subcategory,
            content: item
          });
        });
      }
    });

    // Get fitness knowledge
    const fitnessKnowledge = kbService.fitnessKnowledge || {};
    Object.entries(fitnessKnowledge).forEach(([subcategory, items]: [string, any]) => {
      if (Array.isArray(items)) {
        items.forEach((item: string, index: number) => {
          allKnowledge.push({
            knowledgeId: `fitness_${subcategory}_${index}`,
            category: 'fitness',
            subcategory,
            content: item
          });
        });
      }
    });

    return allKnowledge;
  }

  /**
   * Process batch of knowledge items
   */
  private async processBatch(
    client: any,
    knowledgeItems: Array<{
      knowledgeId: string;
      category: string;
      subcategory: string;
      content: string;
    }>
  ): Promise<void> {
    for (const item of knowledgeItems) {
      try {
        // Create embedding
        const embedding = await this.pgVector.embed(item.content);

        // Metadata
        const metadata = {
          category: item.category,
          subcategory: item.subcategory,
          source: 'internal_knowledge_base'
        };

        // Upsert to database
        const embeddingLiteral = `[${embedding.join(",")}]`;

        const updateRes = await client.query(
          `
          UPDATE knowledge_embeddings
          SET content = $2,
              category = $3,
              subcategory = $4,
              embedding = $5::vector,
              metadata = $6::jsonb,
              updated_at = NOW()
          WHERE knowledge_id = $1
        `,
          [
            item.knowledgeId,
            item.content,
            item.category,
            item.subcategory,
            embeddingLiteral,
            JSON.stringify(metadata)
          ]
        );

        if (updateRes.rowCount === 0) {
          await client.query(
            `
            INSERT INTO knowledge_embeddings (knowledge_id, category, subcategory, content, embedding, metadata)
            VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)
          `,
            [
              item.knowledgeId,
              item.category,
              item.subcategory,
              item.content,
              embeddingLiteral,
              JSON.stringify(metadata)
            ]
          );
        }

        // Rate limiting
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        logger.error(`Failed to process knowledge item ${item.knowledgeId}:`, error);
      }
    }
  }

  /**
   * Search knowledge bằng semantic search
   */
  async similaritySearch(
    query: string,
    k: number = 5,
    category?: string,
    threshold: number = 0.3
  ): Promise<KnowledgeDocument[]> {
    logger.info(`Searching knowledge: "${query}" (k=${k}, category=${category || 'all'})`);

    const queryEmbedding = await this.pgVector.embed(query);
    const client = await this.pool.connect();

    try {
      let sql = `
        SELECT 
          ke.id,
          ke.knowledge_id,
          ke.category,
          ke.subcategory,
          ke.content,
          ke.metadata,
          1 - (ke.embedding <=> $1::vector) AS similarity
        FROM knowledge_embeddings ke
        WHERE 1 - (ke.embedding <=> $1::vector) > $3
      `;

      const params: any[] = [`[${queryEmbedding.join(",")}]`, k, threshold];

      if (category) {
        sql += ` AND ke.category = $4`;
        params.push(category);
      }

      sql += ` ORDER BY ke.embedding <=> $1::vector LIMIT $2`;

      const result = await client.query(sql, params);

      const documents: KnowledgeDocument[] = result.rows.map((row) => ({
        id: row.id,
        knowledgeId: row.knowledge_id,
        category: row.category,
        subcategory: row.subcategory,
        content: row.content,
        metadata: row.metadata,
        similarity: parseFloat(row.similarity),
      }));

      logger.info(`Found ${documents.length} relevant knowledge items`);

      return documents;
    } catch (error) {
      logger.error("Error searching knowledge:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get embedding stats
   */
  async getEmbeddingStats(): Promise<{ total: number; lastUpdated: string }> {
    const client = await this.pool.connect();

    try {
      const result = await client.query(`
        SELECT 
          COUNT(*) as total,
          MAX(updated_at) as last_updated
        FROM knowledge_embeddings
      `);

      return {
        total: parseInt(result.rows[0].total),
        lastUpdated: result.rows[0].last_updated,
      };
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const knowledgeVectorService = new KnowledgeVectorService();

