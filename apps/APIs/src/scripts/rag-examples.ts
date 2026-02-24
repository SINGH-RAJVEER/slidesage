import type { Slide } from '@slide-sage/contracts';
import { PresentationService } from '../../src/services/presentation.service';
import { RAGService } from '../../src/services/rag.service';

/**
 * Example 1: Store and retrieve search embeddings
 */
async function exampleSearchEmbeddings() {
  console.log('\n=== Example 1: Search Embeddings ===\n');

  const ragService = new RAGService();
  const userId = 'user-123';

  const searches = [
    'How to implement machine learning in Node.js',
    'Best practices for scalable database design',
    'Modern frontend frameworks comparison 2024',
  ];

  console.log('Storing search embeddings...');
  for (const search of searches) {
    try {
      const _embedding = await ragService.storeSearchEmbedding(userId, search);
      console.log(`✓ Stored: "${search.substring(0, 40)}..."`);
    } catch (error) {
      console.error(`✗ Failed to store: "${search}"`, error);
    }
  }

  // Retrieve similar contexts
  const query = 'Machine learning with Node';
  console.log(`\nRetrieving contexts similar to: "${query}"`);

  try {
    const contexts = await ragService.retrieveSimilarContexts(userId, 'pres-123', query, 5, 0.6);

    if (contexts.length === 0) {
      console.log('No similar contexts found');
    } else {
      console.log(`Found ${contexts.length} similar contexts:\n`);
      contexts.forEach((ctx, idx) => {
        console.log(`${idx + 1}. [${ctx.sourceType}] ${ctx.context}`);
        console.log(`   Similarity: ${(ctx.similarity * 100).toFixed(1)}%\n`);
      });
    }
  } catch (error) {
    console.error('Error retrieving contexts:', error);
  }
}

/**
 * Example 2: Store presentation embeddings
 */
async function examplePresentationEmbeddings() {
  console.log('\n=== Example 2: Presentation Embeddings ===\n');

  const ragService = new RAGService();
  const userId = 'user-456';
  const presentationId = 'pres-789';

  // Sample slide data
  const slides: Slide[] = [
    {
      id: 'slide-1',
      type: 'content',
      title: 'Introduction to AI',
      content: 'Explore the fundamentals of artificial intelligence and its applications',
      notes: 'Start slowly, engage the audience',
    },
    {
      id: 'slide-2',
      type: 'content',
      title: 'Machine Learning Basics',
      content: 'Supervised vs unsupervised learning, neural networks',
      notes: 'Use visual examples',
    },
    {
      id: 'slide-3',
      type: 'content',
      title: 'Real-world Applications',
      content: 'Healthcare, finance, transportation, and more',
    },
  ];

  // Store the initial presentation
  const feedback = 'Create a comprehensive presentation about artificial intelligence';

  console.log(`Storing presentation embedding with feedback: "${feedback}"`);
  try {
    const _embedding = await ragService.storePresentationEmbedding(
      presentationId,
      userId,
      feedback,
      slides
    );
    console.log('✓ Presentation embedding stored successfully');
  } catch (error) {
    console.error('✗ Failed to store presentation embedding:', error);
  }

  // Store an iteration
  const iterationFeedback = 'Make the content more technical and add more details';
  console.log(`\nStoring iteration embedding with feedback: "${iterationFeedback}"`);
  try {
    const _iteration = await ragService.storePresentationEmbedding(
      presentationId,
      userId,
      iterationFeedback,
      slides
    );
    console.log('✓ Iteration embedding stored successfully');
  } catch (error) {
    console.error('✗ Failed to store iteration embedding:', error);
  }
}

/**
 * Example 3: Build RAG context for LLM prompts
 */
async function exampleRagContextBuilding() {
  console.log('\n=== Example 3: Building RAG Context ===\n');

  const ragService = new RAGService();
  const userId = 'user-user-123';
  const presentationId = 'pres-123';
  const query = 'Make the presentation more engaging and interactive';

  console.log(`Building RAG context for iteration query:\n"${query}"\n`);

  try {
    const ragContext = await ragService.buildRagContextString(userId, presentationId, query);

    if (ragContext.length === 0) {
      console.log('No relevant context found in RAG.');
      console.log('The LLM will proceed without previous context.');
    } else {
      console.log('RAG Context to be included in LLM prompt:');
      console.log('─'.repeat(50));
      console.log(ragContext);
      console.log('─'.repeat(50));
      console.log('\nThis context would be prepended to the system prompt.');
    }
  } catch (error) {
    console.error('Error building RAG context:', error);
  }
}

/**
 * Example 4: Integration with PresentationService
 */
async function examplePresentationServiceIntegration() {
  console.log('\n=== Example 4: PresentationService Integration ===\n');

  const presentationService = new PresentationService();
  const userId = 'user-123';
  const presentationId = 'pres-123';

  const sampleSlides: Slide[] = [
    {
      id: 'slide-1',
      type: 'content',
      title: 'Sample Slide',
      content: 'Sample content',
    },
  ];

  // Store iteration with embedding
  try {
    console.log('Storing iteration through PresentationService...');
    await presentationService.storeIterationWithEmbedding(
      presentationId,
      userId,
      'Improve the visual design',
      sampleSlides
    );
    console.log('✓ Iteration stored with embedding');
  } catch (error) {
    console.error('✗ Failed:', error);
  }

  // Retrieve RAG context
  try {
    console.log('\nRetrieving RAG context through PresentationService...');
    const ragContext = await presentationService.getRagContextForIteration(
      userId,
      presentationId,
      'Make the design more modern'
    );

    if (ragContext) {
      console.log('✓ RAG context retrieved:');
      console.log(`${ragContext.substring(0, 200)}...`);
    } else {
      console.log('No RAG context available');
    }
  } catch (error) {
    console.error('✗ Failed:', error);
  }
}

/**
 * Example 5: Cleanup old embeddings
 */
async function exampleCleanup() {
  console.log('\n=== Example 5: Cleanup Old Embeddings ===\n');

  const ragService = new RAGService();
  const userId = 'user-123';

  console.log('Cleaning up embeddings older than 30 days...');

  try {
    const deletedCount = await ragService.cleanupOldEmbeddings(userId, 30);
    console.log(`✓ Deleted ${deletedCount} old embeddings`);
  } catch (error) {
    console.error('✗ Cleanup failed:', error);
  }
}

/**
 * Run all examples
 */
async function _runExamples() {
  try {
    await exampleSearchEmbeddings();
    await examplePresentationEmbeddings();
    await exampleRagContextBuilding();
    await examplePresentationServiceIntegration();
    await exampleCleanup();

    console.log('Examples Complete');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

_runExamples().catch(console.error);

export {
  exampleSearchEmbeddings,
  examplePresentationEmbeddings,
  exampleRagContextBuilding,
  examplePresentationServiceIntegration,
  exampleCleanup,
};
