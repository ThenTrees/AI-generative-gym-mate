import dotenv from "dotenv";
dotenv.config();

export const config = {
  // Server
  port: parseInt(process.env.PORT || "3001"),
  nodeEnv: process.env.NODE_ENV || "development",

  // Database (Main App Database)
  database: {
    host: process.env.MAIN_DB_HOST || "localhost",
    port: parseInt(process.env.MAIN_DB_PORT || "5432"),
    name: process.env.MAIN_DB_NAME || "gymhealthtech",
    user: process.env.MAIN_DB_USER || "postgres",
    password: process.env.MAIN_DB_PASSWORD || "root",
  },

  // Vector Database
  chroma: {
    host: process.env.CHROMA_HOST || "localhost",
    port: parseInt(process.env.CHROMA_PORT || "8000"),
    workoutCollection: "fitness_workout_knowledge",
    nutritionCollection: "fitness_nutrition_knowledge",
  },

  // AI Services
  openai: {
    apiKey: process.env.OPENAI_API_KEY!,
    model: process.env.OPENAI_MODEL || "gpt-4",
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE || "0.7"),
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || "2500"),
    embeddingModel:
      process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-ada-002",
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || "info",
    enableConsole: process.env.ENABLE_CONSOLE_LOG === "true",
    enableFile: process.env.ENABLE_FILE_LOG === "true",
  },

  // Sync
  sync: {
    enableAutoSync: process.env.ENABLE_AUTO_SYNC === "true",
    syncIntervalHours: parseInt(process.env.SYNC_INTERVAL_HOURS || "24"),
  },

  // API
  api: {
    rateLimit: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || "900000"), // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX || "100"), // limit each IP to 100 requests per windowMs
    },
    cors: {
      origin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:3000"],
    },
  },
};
// Validation
if (!config.openai.apiKey) {
  throw new Error("OPENAI_API_KEY is required");
}
