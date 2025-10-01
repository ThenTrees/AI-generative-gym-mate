import { logger } from "./utils/logger";
import { pgVectorService } from "./services/pgVector.service";
import * as cron from "node-cron";

class RAGApplication {
  async initialize() {
    logger.info("Starting RAG Application ...");
    try {
      // Init vector service (tables, clients, embeddings model)
      await pgVectorService.initialize();

      // Optional: refresh embeddings on startup
      try {
        if (process.env.RUN_BATCH === "true") {
          await pgVectorService.refreshEmbeddings();
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
