-- Drop existing match_documents function
DROP FUNCTION IF EXISTS match_documents(vector, float, int);

-- Recreate match_documents function with category and page_number
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(1024),
  match_threshold float,
  match_count int
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float,
  category text,
  page_number int
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.content,
    jsonb_build_object(
      'title', d.title,
      'year', d.year,
      'issue', d.issue,
      'source_type', d.source_type
    ) as metadata,
    1 - (s.embedding <=> query_embedding) as similarity,
    s.category,
    s.page_number
  FROM sections s
  INNER JOIN documents d ON s.document_id = d.id
  WHERE 1 - (s.embedding <=> query_embedding) > match_threshold
  ORDER BY s.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
