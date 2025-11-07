import { knowledgeVectorService } from "../services/knowledgeVector.service";
import { logger } from "../utils/logger";

async function testRAG() {
  console.log("🧪 Testing RAG Knowledge Search...\n");

  try {
    // Test 1: Check if embeddings exist
    console.log("📊 Checking knowledge embeddings stats...");
    const stats = await knowledgeVectorService.getEmbeddingStats();
    console.log(`Total embeddings: ${stats.total}`);
    console.log(`Last updated: ${stats.lastUpdated || 'N/A'}\n`);

    if (stats.total === 0) {
      console.log("⚠️  No embeddings found. Please run knowledge embedding generation first.");
      console.log("Set RUN_BATCH=true in .env and restart the app.\n");
      await knowledgeVectorService.close();
      process.exit(1);
    }

    // Test 2: Test queries
    const testQueries = [
      {
        query: "cách tập ngực hiệu quả",
        category: "exercise",
        description: "Exercise query - chest training"
      },
      {
        query: "protein cần bao nhiêu để tăng cơ",
        category: "nutrition",
        description: "Nutrition query - protein for muscle gain"
      },
      {
        query: "làm sao để giảm cân",
        category: undefined,
        description: "General query - weight loss"
      },
      {
        query: "progressive overload là gì",
        category: "exercise",
        description: "Exercise query - progressive overload"
      },
      {
        query: "động lực tập luyện",
        category: "fitness",
        description: "Fitness query - motivation"
      }
    ];

    console.log("🔍 Testing semantic search queries...\n");

    for (const testCase of testQueries) {
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`Query: "${testCase.query}"`);
      console.log(`Category: ${testCase.category || 'all'}`);
      console.log(`Description: ${testCase.description}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      try {
        const results = await knowledgeVectorService.similaritySearch(
          testCase.query,
          3, // top 3
          testCase.category
        );

        if (results.length === 0) {
          console.log("❌ No results found\n");
        } else {
          console.log(`✅ Found ${results.length} results:\n`);
          results.forEach((result, idx) => {
            console.log(`${idx + 1}. [${result.category}/${result.subcategory}]`);
            console.log(`   Similarity: ${(result.similarity! * 100).toFixed(1)}%`);
            console.log(`   Content: ${result.content.substring(0, 150)}...`);
            console.log("");
          });
        }
      } catch (error: any) {
        console.log(`❌ Error: ${error.message}\n`);
      }

      // Small delay between queries
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("✅ RAG Test completed!");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  } catch (error: any) {
    console.error("❌ Test failed:", error);
    logger.error("RAG test error:", error);
  } finally {
    await knowledgeVectorService.close();
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  testRAG().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export { testRAG };

