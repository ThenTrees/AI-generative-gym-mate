import * as cron from "node-cron";
import { logger } from "./utils/logger";
import { validateConfig } from "./configs/environment";
import { pgVectorService } from "./services/pgVector.service";
import { foodVectorService } from "./services/foodVector.service";
import { knowledgeVectorService } from "./services/knowledgeVector.service";

class RAGApplication {
  async initialize() {
    logger.info("Starting RAG Application ...");
    try {
      // Validate environment upfront
      validateConfig();

      // Init vector service (tables, clients, embeddings model)
      await pgVectorService.initialize();
      await foodVectorService.initialize();

      // ✅ NEW: Initialize knowledge embeddings
      try {
        const stats = await knowledgeVectorService.getEmbeddingStats();
        if (stats.total === 0) {
          logger.info("No knowledge embeddings found, loading knowledge base...");
          await knowledgeVectorService.loadAndStoreKnowledge();
        } else {
          logger.info(`Found ${stats.total} existing knowledge embeddings`);
        }
      } catch (e) {
        logger.warn("Knowledge embeddings initialization failed:", e);
        logger.warn("Continuing without knowledge embeddings (will use fallback)");
      }

      // Optional: refresh embeddings on startup
      try {
        if (process.env.RUN_BATCH === "true") {
          await pgVectorService.refreshEmbeddings();
          // Also refresh knowledge embeddings
          await knowledgeVectorService.loadAndStoreKnowledge();
        }
      } catch (e) {
        logger.warn("Startup embedding refresh failed, continuing to serve.");
      }

      // Init query service
      // await this.queryService.initialize();
      // Setup Scheduler for auto-sync
      // Cron every day at 2 AM
      cron.schedule("0 2 * * *", async () => {
        logger.info("Cron: refreshing exercise embeddings...");
        try {
          await pgVectorService.refreshEmbeddings();
          logger.info("Cron: embeddings refreshed successfully");
        } catch (err) {
          logger.error("Cron: failed to refresh embeddings", err);
        }
      });

      // ✅ NEW: Cron to refresh knowledge embeddings daily at 3 AM
      cron.schedule("0 3 * * *", async () => {
        logger.info("Cron: refreshing knowledge embeddings...");
        try {
          await knowledgeVectorService.loadAndStoreKnowledge();
          logger.info("Cron: knowledge embeddings refreshed successfully");
        } catch (err) {
          logger.error("Cron: failed to refresh knowledge embeddings", err);
        }
      });

      // Cron every 6 hours
      if (process.env.RUN_BATCH === "true") {
        cron.schedule("0 */6 * * *", async () => {
          logger.info("Cron: 6-hour refresh starting...");
          try {
            await pgVectorService.refreshEmbeddings();
            logger.info("Cron: 6-hour refresh completed");
          } catch (err) {
            logger.error("Cron: 6-hour refresh failed", err);
          }
        });
      }
      logger.info("RAG Application ready!");
    } catch (error) {
      logger.error("Failed to initialize application:", error);
      process.exit(1);
    }
  }
}

async function main() {
  const app = new RAGApplication();

  await app.initialize();
}
if (require.main === module) {
  main().catch(console.error);
}

export { RAGApplication };
