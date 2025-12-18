import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.string().optional(),
  NODE_ENV: z.string().optional(),

  MAIN_DB_HOST: z.string().optional(),
  MAIN_DB_PORT: z.string().optional(),
  MAIN_DB_NAME: z.string().optional(),
  MAIN_DB_USER: z.string().optional(),
  MAIN_DB_PASSWORD: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  GEMINI_TEMPERATURE: z.string().optional(),
  GEMINI_MAX_TOKENS: z.string().optional(),
  GEMINI_EMBEDDING_MODEL: z.string().optional(),

  LOG_LEVEL: z.string().optional(),
  ENABLE_CONSOLE_LOG: z.string().optional(),
  ENABLE_FILE_LOG: z.string().optional(),

  ENABLE_AUTO_SYNC: z.string().optional(),
  SYNC_INTERVAL_HOURS: z.string().optional(),

  RATE_LIMIT_WINDOW: z.string().optional(),
  RATE_LIMIT_MAX: z.string().optional(),
  CORS_ORIGIN: z.string().optional(),
});

export type AppConfig = ReturnType<typeof buildConfig>;

const buildConfig = () => {
  const env = process.env;
  return {
    port: parseInt(env.PORT || "3000", 10),
    nodeEnv: env.NODE_ENV || "development",
    database: {
      host: env.MAIN_DB_HOST || "localhost",
      port: parseInt(env.MAIN_DB_PORT || "5432", 10),
      name: env.MAIN_DB_NAME || "gymhealthtech",
      user: env.MAIN_DB_USER || "postgres",
      password: env.MAIN_DB_PASSWORD || "gymhealthtech",
    },
    gemini: {
      apiKey: env.GEMINI_API_KEY || "",
      model: env.GEMINI_MODEL || "text-embedding-004",
      temperature: parseFloat(env.GEMINI_TEMPERATURE || "0.7"),
      maxTokens: parseInt(env.GEMINI_MAX_TOKENS || "2500", 10),
      embeddingModel: env.GEMINI_EMBEDDING_MODEL || "text-embedding-004",
    },
    logging: {
      level: env.LOG_LEVEL || "info",
      enableConsole: env.ENABLE_CONSOLE_LOG === "true",
      enableFile: env.ENABLE_FILE_LOG === "true",
    },
    sync: {
      enableAutoSync: env.ENABLE_AUTO_SYNC === "true",
      syncIntervalHours: parseInt(env.SYNC_INTERVAL_HOURS || "24", 10),
    },
    api: {
      rateLimit: {
        windowMs: parseInt(env.RATE_LIMIT_WINDOW || "900000", 10),
        max: parseInt(env.RATE_LIMIT_MAX || "100", 10),
      },
      cors: {
        origin: env.CORS_ORIGIN?.split(",") || ["http://localhost:3000"],
      },
    },
  };
};

let cachedConfig: AppConfig | null = null;

export const loadConfig = (): AppConfig => {
  if (!cachedConfig) {
    cachedConfig = buildConfig();
  }
  if (!cachedConfig) {
    // If still null, force callers to handle validation at startup
    cachedConfig = buildConfig();
  }
  return cachedConfig!;
};

export const validateConfig = () => {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const config = loadConfig();
  if (!config.gemini.apiKey) {
    throw new Error("GEMINI_API_KEY is required");
  }
};
