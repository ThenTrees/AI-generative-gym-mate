-- Enable pgvector extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- Helper function for updated_at column (needed for trigger)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create knowledge_embeddings table
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_id VARCHAR(255) UNIQUE NOT NULL,
    category VARCHAR(100) NOT NULL,
    subcategory VARCHAR(100),
    content TEXT NOT NULL,
    embedding VECTOR(1536),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_category 
ON knowledge_embeddings(category);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_subcategory 
ON knowledge_embeddings(subcategory);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_cosine 
ON knowledge_embeddings USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_metadata 
ON knowledge_embeddings USING GIN (metadata);

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_knowledge_embeddings_updated_at ON knowledge_embeddings;
CREATE TRIGGER update_knowledge_embeddings_updated_at
    BEFORE UPDATE ON knowledge_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
