-- Create vector index for fast similarity search
-- This index is critical for performance of match_documents function
-- Without this index, vector searches will do full table scans (very slow)
CREATE INDEX IF NOT EXISTS sections_embedding_idx 
ON sections 
USING hnsw (embedding vector_cosine_ops);
