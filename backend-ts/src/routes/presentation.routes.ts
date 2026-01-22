import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { authMiddleware, getCurrentUserId } from '../middleware/auth.middleware';
import { PresentationService } from '../services/presentation.service';

const presentations = new Hono();
const presentationService = new PresentationService();

// Generate presentation with streaming
presentations.post('/generate-presentation-stream', authMiddleware, async (c) => {
  try {
    const userId = getCurrentUserId(c);
    const body = await c.req.json();

    const { topic, slide_count, detail_level, tonality } = body;

    if (!topic || !slide_count) {
      return c.json({ error: { message: 'Missing required fields' } }, 400);
    }

    // Create initial presentation record
    const presentation = await presentationService.createPresentation(
      userId,
      'Generating...',
      topic,
      { slides: [], theme: 'default', title: 'Generating...' }
    );

    const presentationId = presentation.id;

    return stream(c, async (stream) => {
      // Send presentation ID immediately
      await stream.write(`event: created\n`);
      await stream.write(`data: ${JSON.stringify({ presentation_id: presentationId })}\n\n`);

      try {
        const allSlides: any[] = [];
        let theme = 'default';
        let title = 'Untitled Presentation';
        let tokensUsed = 0;

        // Stream presentation generation
        for await (const event of presentationService.generatePresentationStream(
          userId,
          topic,
          slide_count,
          detail_level || 'balanced',
          tonality || 'professional'
        )) {
          const eventType = event.event || 'data';
          const eventData = event.data || {};

          // Accumulate data
          if (eventType === 'theme') {
            theme = eventData.theme || theme;
          }

          if (eventType === 'slide') {
            const slide = eventData.slide;
            if (slide) {
              allSlides.push(slide);
            }
            if (eventData.title) {
              title = eventData.title;
            }
          }

          if (eventType === 'complete') {
            if (eventData.slides) {
              allSlides.length = 0;
              allSlides.push(...eventData.slides);
            }
            if (eventData.theme) {
              theme = eventData.theme;
            }
            if (eventData.title) {
              title = eventData.title;
            }
            tokensUsed = eventData.tokens_used || 0;
          }

          // Stream event to frontend
          await stream.write(`event: ${eventType}\n`);
          await stream.write(`data: ${JSON.stringify(eventData)}\n\n`);
        }

        // Save final presentation data
        if (allSlides.length > 0) {
          const finalData = {
            slides: allSlides,
            theme,
            title,
            totalSlides: allSlides.length,
          };

          await presentationService.createPresentation(userId, title, topic, finalData);

          console.log(`Saved presentation ${presentationId} with ${allSlides.length} slides`);

          await stream.write(`event: saved\n`);
          await stream.write(
            `data: ${JSON.stringify({ presentation_id: presentationId, success: true })}\n\n`
          );
        } else {
          console.error(`No slides generated for presentation ${presentationId}`);
          await presentationService.deletePresentation(presentationId, userId);
          await stream.write(`event: error\n`);
          await stream.write(
            `data: ${JSON.stringify({ error: 'Failed to generate presentation content' })}\n\n`
          );
        }
      } catch (error: any) {
        console.error('Error during generation:', error);
        await presentationService.deletePresentation(presentationId, userId);
        await stream.write(`event: error\n`);
        await stream.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      }
    });
  } catch (error: any) {
    return c.json({ error: { message: error.message } }, 400);
  }
});

// Get all presentations
presentations.get('/presentations', authMiddleware, async (c) => {
  try {
    const userId = getCurrentUserId(c);

    const userPresentations = await presentationService.getUserPresentations(userId);

    const presentationsData = userPresentations.map((p) => {
      const slidesData = p.slidesData as any;
      return {
        id: p.id,
        title: p.title,
        slide_count: slidesData?.slides?.length || 0,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      };
    });

    return c.json({ presentations: presentationsData }, 200);
  } catch (error: any) {
    return c.json({ error: { message: error.message } }, 400);
  }
});

// Get specific presentation
presentations.get('/presentations/:id', authMiddleware, async (c) => {
  try {
    const userId = getCurrentUserId(c);
    const presentationId = Number.parseInt(c.req.param('id'));

    if (isNaN(presentationId)) {
      return c.json({ error: { message: 'Invalid presentation ID' } }, 400);
    }

    const presentation = await presentationService.getPresentation(presentationId, userId);

    return c.json(
      {
        presentation: {
          id: presentation.id,
          title: presentation.title,
          prompt: presentation.prompt,
          slides_data: presentation.slidesData,
          created_at: presentation.createdAt,
          updated_at: presentation.updatedAt,
        },
      },
      200
    );
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return c.json({ error: { message: error.message } }, 404);
    }
    if (error.message.includes('Unauthorized')) {
      return c.json({ error: { message: error.message } }, 403);
    }
    return c.json({ error: { message: error.message } }, 400);
  }
});

// Delete presentation
presentations.delete('/presentations/:id', authMiddleware, async (c) => {
  try {
    const userId = getCurrentUserId(c);
    const presentationId = Number.parseInt(c.req.param('id'));

    if (isNaN(presentationId)) {
      return c.json({ error: { message: 'Invalid presentation ID' } }, 400);
    }

    await presentationService.deletePresentation(presentationId, userId);

    return c.json({ message: 'Presentation deleted successfully' }, 200);
  } catch (error: any) {
    if (error.message.includes('not found')) {
      return c.json({ error: { message: error.message } }, 404);
    }
    if (error.message.includes('Unauthorized')) {
      return c.json({ error: { message: error.message } }, 403);
    }
    return c.json({ error: { message: error.message } }, 400);
  }
});

export default presentations;
