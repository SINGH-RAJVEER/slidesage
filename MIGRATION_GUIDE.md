# Migration Guide: OpenAI to Gemini Embeddings

This guide explains how to migrate from OpenAI's text-embedding-3-small to Gemini's text-embedding-004 model.

## Overview of Changes

The embedding model has been changed from:
- **Old**: OpenAI `text-embedding-3-small` (1536 dimensions)
- **New**: Gemini `text-embedding-004` (768 dimensions)

### Key Benefits
- Better performance and quality with Gemini's latest embedding model
- Reduced storage requirements (768 vs 1536 dimensions = ~50% reduction)
- Lower costs for embedding generation

## Migration Steps

### 1. Update Environment Variables

Add the Gemini API key to your `.env` file:

```bash
# Add this new variable
GEMINI_API_KEY=your-gemini-api-key

# Update the embedding model (if you had it set)
EMBEDDING_MODEL=gemini/text-embedding-004
```

### 2. Update LiteLLM Configuration

The `litellm_config.yaml` has been updated to use Gemini instead of OpenAI for embeddings.

If you're running LiteLLM, restart it to pick up the new configuration:

```bash
# If running via Docker
bash -lc 'cd docker/compose && docker compose -f docker-compose.dev.yml restart litellm'

# If running locally
bash -lc 'litellm --config litellm_config.yaml --port 4000'
```

### 3. Run Database Migration

**⚠️ WARNING**: This migration will **drop all existing embeddings** because the vector dimensions are changing from 1536 to 768.

```bash
# Navigate to the APIs directory
cd apps/APIs

# Run the migration
bash -lc 'bun run drizzle-kit push'

# Or manually run the migration SQL
bash -lc 'psql $DATABASE_URL -f drizzle/0003_update_embeddings_to_768_dims.sql'
```

**Alternative**: If you want to keep your existing embeddings, you'll need to:

1. Export existing embeddings
2. Re-generate them using the new Gemini model
3. Import the new embeddings

However, this is typically not necessary as embeddings are used for contextual search and can be regenerated as users create new presentations.

### 4. Verify the Migration

Run the test script to verify embeddings are working correctly:

```bash
cd apps/APIs
bash -lc 'bun run src/scripts/test-rag.ts'
```

Expected output:
- Embedding dimension: 768
- Model used: gemini/text-embedding-004

### 5. Regenerate Embeddings (Optional)

If you have existing presentations and want to enable RAG features for them:

```bash
cd apps/APIs
bash -lc 'bun run src/scripts/manage.ts regenerate-embeddings'
```

Note: This script may need to be created if it doesn't exist yet.

## Rollback Instructions

If you need to rollback to OpenAI embeddings:

### 1. Revert Environment Variables

```bash
OPENAI_API_KEY=your-openai-api-key
EMBEDDING_MODEL=text-embedding-3-small
```

### 2. Revert LiteLLM Configuration

In `litellm_config.yaml`:

```yaml
- model_name: text-embedding-3-small
  litellm_params:
    model: openai/text-embedding-3-small
    api_key: os.environ/OPENAI_API_KEY
```

### 3. Revert Database Schema

You'll need to create a reverse migration to change dimensions back to 1536:

```sql
-- Drop indexes
DROP INDEX IF EXISTS search_embeddings_embedding_idx;
DROP INDEX IF EXISTS presentation_embeddings_embedding_idx;

-- Alter dimensions
ALTER TABLE search_embeddings ALTER COLUMN embedding TYPE vector(1536);
ALTER TABLE presentation_embeddings ALTER COLUMN embedding TYPE vector(1536);

-- Recreate indexes
CREATE INDEX search_embeddings_embedding_idx ON search_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX presentation_embeddings_embedding_idx ON presentation_embeddings USING hnsw (embedding vector_cosine_ops);
```

### 4. Revert Code Changes

Use git to revert the changes:

```bash
git revert <commit-hash>
```

## Testing

After migration, test the following features:

1. **Search Storage**: Search for a topic and verify the query is stored
2. **Presentation Creation**: Create a new presentation and verify it stores embeddings
3. **Presentation Iteration**: Iterate on a presentation and verify RAG context is retrieved
4. **Similarity Search**: Verify that similar contexts are found correctly

## Troubleshooting

### LiteLLM Connection Errors

If you see errors connecting to LiteLLM:
- Verify LiteLLM is running: `curl http://localhost:4000/health`
- Check the LITELLM_PROXY_BASE environment variable
- Restart the LiteLLM service

### Gemini API Errors

If you see Gemini API errors:
- Verify your GEMINI_API_KEY is valid
- Check API quota and billing in Google Cloud Console
- Ensure the Gemini API is enabled in your project

### Dimension Mismatch Errors

If you see dimension mismatch errors:
- Verify the database migration completed successfully
- Check that all tables use vector(768)
- Clear any cached embeddings

## Support

For issues or questions:
1. Check the [RAG Implementation Documentation](docs/RAG_IMPLEMENTATION.md)
2. Review the [Development Setup Guide](docs/DEVELOPMENT_SETUP.md)
3. Open an issue on GitHub
