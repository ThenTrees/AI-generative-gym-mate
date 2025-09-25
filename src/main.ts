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
        await pgVectorService.refreshEmbeddings();
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
      cron.schedule("0 */6 * * *", async () => {
        logger.info("Cron: 6-hour refresh starting...");
        try {
          await pgVectorService.refreshEmbeddings();
          logger.info("Cron: 6-hour refresh completed");
        } catch (err) {
          logger.error("Cron: 6-hour refresh failed", err);
        }
      });
      logger.info("RAG Application ready!");
    } catch (error) {
      logger.error("Failed to initialize application:", error);
      process.exit(1);
    }
  }

  async askQuestion(question: string) {
    try {
      // const result = await this.queryService.query(question);
      // console.log("\n🎯 Answer:", result.answer);
      // console.log("\n📚 Sources:");
      // result.sources.forEach((source, index) => {
      // console.log(`${index + 1}. [${source.table}] ${source.title}`);
      // });
      // return result;
    } catch (error) {
      console.error("❌ Failed to answer question:", error);
      throw error;
    } finally {
    }
  }

  async forceSync(): Promise<void> {
    // await this.syncService.forceSyncNow();
  }
}

async function main() {
  const app = new RAGApplication();

  await app.initialize();

  // Example queries
  const questions = [
    "Hãy gợi ý cho tôi kế hoạch tập luyện để có thể giảm cân cho người mới bắt đầu?",
    "Cách để tăng cân bằng tập thể dục?",
    "Nên tập những bài nào để phát triển cơ cách tay sau?",
  ];

  for (const question of questions) {
    console.log(`\n${"=".repeat(50)}`);
    await app.askQuestion(question);
  }
}
if (require.main === module) {
  main().catch(console.error);
}

export { RAGApplication };
