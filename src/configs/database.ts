import fs from "fs";
import dotenv from "dotenv";
import path from "path";
import { loadConfig } from "./environment";

dotenv.config();

const config = loadConfig();

export const DATABASE_CONFIG = {
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  ssl: {
    rejectUnauthorized: true,
    ca: fs
      .readFileSync(
        path.resolve(
          process.env.DB_SSL_CERT || "./certs/ap-southeast-1-bundle.pem"
        )
      )
      .toString(),
  },
};

export const GEMINI_API_KEY = config.gemini.apiKey;

// SQL setup script
export const PGVECTOR_SETUP_SQL = `
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create embeddings table
CREATE TABLE IF NOT EXISTS exercise_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exercise_id UUID NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(1536), 
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_exercise_embeddings_exercise_id 
ON exercise_embeddings(exercise_id);

CREATE INDEX IF NOT EXISTS idx_exercise_embeddings_cosine 
ON exercise_embeddings USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_exercise_embeddings_metadata 
ON exercise_embeddings USING GIN (metadata);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_exercise_embeddings_updated_at ON exercise_embeddings;
CREATE TRIGGER update_exercise_embeddings_updated_at
    BEFORE UPDATE ON exercise_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
`;
