import json
import logging
import re
from typing import Generator
from app.config import Config
from app.services.ai_prompts import build_generation_prompt, build_iteration_prompt
from app.utils.json_recovery import recover_json, JSONRecoveryError
from app.utils.stream_processor import StreamProcessor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    import litellm
    from litellm import completion
except Exception:
    litellm = None
    completion = None

class AIService:
    def __init__(self):
        if completion is None:
            logger.warning("litellm SDK not available")
        else:
            logger.info("AI Service initialized")

    def _process_slide(self, slide: dict, index: int) -> dict:
        if not isinstance(slide, dict):
            logger.warning(f"Invalid slide {index}, skipping")
            return None

        slide['id'] = slide.get('id', f'slide-{index+1}')
        slide['type'] = slide.get('type', 'content')

        if slide['type'] == 'chart' and 'chartConfig' not in slide:
            logger.warning(f"Chart slide {index} missing chartConfig, converting to content")
            slide['type'] = 'content'
            slide['html'] = '<div id="slide-content"><h2 id="slide-title">Data Visualization</h2><p id="slide-description">Chart data unavailable</p></div>'

        elif 'html' in slide and slide['html']:
            html_content = slide['html'].strip()
            if not html_content.startswith('<div id="slide-content">'):
                slide['html'] = f'<div id="slide-content">{html_content}</div>'
                logger.info(f"Added slide-content wrapper to slide {index}")

        return slide
    
    def _handle_json_parse_error(self, clean_content: str, e: json.JSONDecodeError, processor: StreamProcessor) -> dict:
        """Handle JSON parsing errors with recovery strategies"""
        try:
            parsed_content = recover_json(clean_content, e)
            
            # Process recovered slides
            if 'slides' in parsed_content:
                for idx in range(processor.slides_yielded, len(parsed_content['slides'])):
                    slide = parsed_content['slides'][idx]
                    self._process_slide(slide, idx)
            
            # Add metadata
            if processor.title_extracted:
                parsed_content['title'] = processor.title_extracted
            else:
                parsed_content['title'] = 'Untitled Presentation'
            
            if 'slides' in parsed_content:
                parsed_content['totalSlides'] = len(parsed_content['slides'])
            
            parsed_content['tokens_used'] = processor.total_tokens_used
            
            return parsed_content
            
        except JSONRecoveryError:
            return None

    def generate_presentation_stream(self, user_prompt: str, slide_count: int = 8, detail_level: str = 'balanced', tonality: str = 'professional') -> Generator[dict, None, None]:
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"Starting generate_presentation_stream for prompt: {user_prompt[:50]}... with {slide_count} slides")
        try:
            # Build system prompt using imported prompt builder
            system_prompt = build_generation_prompt(detail_level=detail_level, tonality=tonality)

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Create a comprehensive presentation with data visualizations about: {user_prompt} in {slide_count} slides."}
            ]

            if completion is None:
                raise RuntimeError("litellm SDK is not installed or failed to import")

            model_setting = Config.LITELLM_MODEL

            provider = None
            model_name = model_setting
            if isinstance(model_setting, str) and '/' in model_setting:
                provider, model_name = model_setting.split('/', 1)

            logger.info("LiteLLM streaming model_setting=%s", model_setting)
            logger.info("Parsed provider=%s, model_name=%s", provider, model_name)

            try:
                if provider:
                    resp = completion(model=f"{provider}/{model_name}", messages=messages, stream=True, stream_options={"include_usage": True})
                else:
                    resp = completion(model=model_name, messages=messages, stream=True, stream_options={"include_usage": True})
            except Exception as e:
                err_name = type(e).__name__
                logger.error("LiteLLM streaming completion failed (%s). provider=%s model=%s error=%s", err_name, provider, model_name, str(e))
                raise RuntimeError(f"LiteLLM streaming completion failed (provider={provider}, model={model_name}): {e}") from e

            # Initialize stream processor
            processor = StreamProcessor()
            
            # Yield initial event
            yield {"event": "start", "data": {"status": "generating"}}
            
            logger.info("Starting to process streaming chunks from LiteLLM")
            chunk_count = 0

            for chunk in resp:
                chunk_count += 1
                
                # Process chunk and update token usage
                chunk_content = processor.process_chunk(chunk)
                
                # Accumulate content for final processing
                if chunk_content:
                    processor.accumulate_content(chunk_content)
                
                if chunk_count % 10 == 0:
                    logger.info(f"Processed {chunk_count} chunks, accumulated {len(processor.accumulated_content)} characters")

                if chunk_content:
                    # Extract and yield theme if not yet yielded
                    if not processor.theme_yielded:
                        theme = processor.extract_theme()
                        if theme:
                            yield {"event": "theme", "data": {"theme": theme}}
                    
                    # Extract and yield any new complete slides
                    new_slides = processor.extract_slides()
                    for idx, slide in new_slides:
                        processed_slide = self._process_slide(slide, idx)
                        if processed_slide:
                            # Extract title from first slide
                            if idx == 0 and processor.title_extracted is None:
                                processor.title_extracted = processor.extract_title_from_slide(slide)
                            
                            yield {
                                "event": "slide",
                                "data": {
                                    "slide": processed_slide,
                                    "index": idx,
                                    "title": processor.title_extracted
                                }
                            }

            # Final processing of complete response
            logger.info(f"Streaming complete. Total chunks: {chunk_count}, Total content length: {len(processor.accumulated_content)}")
            
            clean_content = processor.get_clean_content()
            if not clean_content:
                logger.error("No content received from LiteLLM API!")
                yield {
                    "event": "error",
                    "data": {"error": "No response received from AI model. Check your API key and model configuration."}
                }
                return
            
            logger.info(f"First 200 chars of response: {clean_content[:200]}")
            logger.info(f"Last 200 chars of response: {clean_content[-200:]}")

            try:
                parsed_content = json.loads(clean_content)
                logger.info(f"Successfully parsed JSON response with {len(parsed_content.get('slides', []))} slides")
                
                # Process any remaining slides that weren't yielded during streaming
                if 'slides' in parsed_content:
                    for idx in range(processor.slides_yielded, len(parsed_content['slides'])):
                        slide = parsed_content['slides'][idx]
                        processed_slide = self._process_slide(slide, idx)
                        if processed_slide:
                            processor.slides_yielded += 1
                            yield {
                                "event": "slide",
                                "data": {
                                    "slide": processed_slide,
                                    "index": idx,
                                    "title": processor.title_extracted
                                }
                            }
                
                # Add title to parsed content
                if processor.title_extracted:
                    parsed_content['title'] = processor.title_extracted
                else:
                    parsed_content['title'] = 'Untitled Presentation'
                
                if 'slides' in parsed_content:
                    parsed_content['totalSlides'] = len(parsed_content['slides'])
                
                # Add token usage to the response
                parsed_content['tokens_used'] = processor.total_tokens_used
                logger.info(f"Generation completed. Total tokens used: {processor.total_tokens_used}")
                
                # Yield completion event with full presentation data
                yield {
                    "event": "complete",
                    "data": parsed_content
                }
                
            except json.JSONDecodeError as e:
                logger.error(f"JSON parsing error in stream: {e}")
                logger.error(f"Content length: {len(clean_content)}, First 500 chars: {clean_content[:500]}")
                logger.error(f"Error position: line {e.lineno} column {e.colno} (char {e.pos})")
                
                error_start = max(0, e.pos - 100)
                error_end = min(len(clean_content), e.pos + 100)
                logger.error(f"Error context: ...{clean_content[error_start:error_end]}...")
                
                # Use centralized error recovery
                parsed_content = self._handle_json_parse_error(clean_content, e, processor)
                
                if parsed_content:
                    # Process any remaining slides
                    if 'slides' in parsed_content:
                        for idx in range(processor.slides_yielded, len(parsed_content['slides'])):
                            slide = parsed_content['slides'][idx]
                            processed_slide = self._process_slide(slide, idx)
                            if processed_slide:
                                processor.slides_yielded += 1
                                yield {
                                    "event": "slide",
                                    "data": {
                                        "slide": processed_slide,
                                        "index": idx,
                                        "title": processor.title_extracted
                                    }
                                }
                    
                    yield {
                        "event": "complete",
                        "data": parsed_content
                    }
                else:
                    logger.error("Could not recover from JSON error")
                    # Save the malformed content to a file for debugging
                    try:
                        import tempfile
                        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json', prefix='litellm_error_') as f:
                            f.write(clean_content)
                            logger.error(f"Saved malformed JSON to: {f.name}")
                    except:
                        pass
                    
                    yield {
                        "event": "error",
                        "data": {"error": "Failed to parse AI response"}
                    }

        except Exception as e:
            logger.error(f"Error in streaming presentation: {e}", exc_info=True)
            yield {
                "event": "error",
                "data": {"error": str(e)}
            }

    def iterate_presentation_stream(self, user_prompt: str, previous_presentation: dict, slide_count: int = 8, detail_level: str = 'balanced', tonality: str = 'professional') -> Generator[dict, None, None]:
        try:
            # Convert previous presentation to a summary for context
            previous_slides_summary = []
            for idx, slide in enumerate(previous_presentation.get('slides', [])):
                slide_summary = f"Slide {idx + 1}: "
                if slide.get('type') == 'chart':
                    chart_config = slide.get('chartConfig', {})
                    slide_summary += f"Chart - {chart_config.get('title', 'Untitled')} ({chart_config.get('type', 'unknown')} chart)"
                else:
                    # Extract text from HTML
                    html_content = slide.get('html', '')
                    # Simple text extraction (remove HTML tags)
                    text_content = re.sub(r'<[^>]+>', ' ', html_content)
                    text_content = ' '.join(text_content.split())[:200]  # Limit to 200 chars
                    slide_summary += text_content
                previous_slides_summary.append(slide_summary)
            
            previous_context = "\n".join(previous_slides_summary)
            
            # Build system prompt using imported prompt builder
            system_prompt = build_iteration_prompt(detail_level=detail_level, tonality=tonality)

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"""Previous presentation content:

{previous_context}

User's iteration instructions: {user_prompt}

Please create an updated presentation with approximately {slide_count} slides that incorporates the user's requested changes while maintaining the quality and structure of the original presentation."""}
            ]

            if completion is None:
                raise RuntimeError("litellm SDK is not installed or failed to import")

            model_setting = Config.LITELLM_MODEL

            provider = None
            model_name = model_setting
            if isinstance(model_setting, str) and '/' in model_setting:
                provider, model_name = model_setting.split('/', 1)

            logger.info("LiteLLM iteration streaming model_setting=%s", model_setting)
            logger.info("Parsed provider=%s, model_name=%s", provider, model_name)

            try:
                if provider:
                    resp = completion(model=f"{provider}/{model_name}", messages=messages, stream=True, stream_options={"include_usage": True})
                else:
                    resp = completion(model=model_name, messages=messages, stream=True, stream_options={"include_usage": True})
            except Exception as e:
                err_name = type(e).__name__
                logger.error("LiteLLM iteration streaming completion failed (%s). provider=%s model=%s error=%s", err_name, provider, model_name, str(e))
                raise RuntimeError(f"LiteLLM iteration streaming completion failed (provider={provider}, model={model_name}): {e}") from e

            # Initialize stream processor
            processor = StreamProcessor()
            
            # Yield initial event
            yield {"event": "start", "data": {"status": "generating"}}

            for chunk in resp:
                # Process chunk and update token usage
                chunk_content = processor.process_chunk(chunk)

                # Accumulate content for final processing
                if chunk_content:
                    processor.accumulate_content(chunk_content)
                
                if chunk_content:
                    # Extract and yield theme if not yet yielded
                    if not processor.theme_yielded:
                        theme = processor.extract_theme()
                        if theme:
                            yield {"event": "theme", "data": {"theme": theme}}
                    
                    # Extract and yield any new complete slides
                    new_slides = processor.extract_slides()
                    for idx, slide in new_slides:
                        processed_slide = self._process_slide(slide, idx)
                        if processed_slide:
                            # Extract title from first slide
                            if idx == 0 and processor.title_extracted is None:
                                processor.title_extracted = processor.extract_title_from_slide(slide)
                            
                            yield {
                                "event": "slide",
                                "data": {
                                    "slide": processed_slide,
                                    "index": idx,
                                    "title": processor.title_extracted
                                }
                            }

            # Final processing of complete response
            clean_content = processor.get_clean_content()

            try:
                parsed_content = json.loads(clean_content)
                
                # Process any remaining slides that weren't yielded during streaming
                if 'slides' in parsed_content:
                    for idx in range(processor.slides_yielded, len(parsed_content['slides'])):
                        slide = parsed_content['slides'][idx]
                        processed_slide = self._process_slide(slide, idx)
                        if processed_slide:
                            processor.slides_yielded += 1
                            yield {
                                "event": "slide",
                                "data": {
                                    "slide": processed_slide,
                                    "index": idx,
                                    "title": processor.title_extracted
                                }
                            }
                
                # Add title to parsed content
                if processor.title_extracted:
                    parsed_content['title'] = processor.title_extracted
                else:
                    parsed_content['title'] = 'Updated Presentation'
                
                if 'slides' in parsed_content:
                    parsed_content['totalSlides'] = len(parsed_content['slides'])
                
                # Add token usage to the response
                parsed_content['tokens_used'] = processor.total_tokens_used
                logger.info(f"Iteration completed. Total tokens used: {processor.total_tokens_used}")
                
                # Yield completion event with full presentation data
                yield {
                    "event": "complete",
                    "data": parsed_content
                }
                
            except json.JSONDecodeError as e:
                logger.error(f"JSON parsing error in iteration stream: {e}")
                logger.error(f"Content length: {len(clean_content)}, First 500 chars: {clean_content[:500]}")
                logger.error(f"Error position: line {e.lineno} column {e.colno} (char {e.pos})")
                
                error_start = max(0, e.pos - 100)
                error_end = min(len(clean_content), e.pos + 100)
                logger.error(f"Error context: ...{clean_content[error_start:error_end]}...")
                
                # Use centralized error recovery (with 'Updated Presentation' fallback title)
                parsed_content = self._handle_json_parse_error(clean_content, e, processor)
                if parsed_content and parsed_content['title'] == 'Untitled Presentation':
                    parsed_content['title'] = 'Updated Presentation'
                
                if parsed_content:
                    # Process any remaining slides
                    if 'slides' in parsed_content:
                        for idx in range(processor.slides_yielded, len(parsed_content['slides'])):
                            slide = parsed_content['slides'][idx]
                            processed_slide = self._process_slide(slide, idx)
                            if processed_slide:
                                processor.slides_yielded += 1
                                yield {
                                    "event": "slide",
                                    "data": {
                                        "slide": processed_slide,
                                        "index": idx,
                                        "title": processor.title_extracted
                                    }
                                }
                    
                    yield {
                        "event": "complete",
                        "data": parsed_content
                    }
                else:
                    logger.error("Could not recover from JSON error")
                    # Save the malformed content to a file for debugging
                    try:
                        import tempfile
                        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json', prefix='litellm_error_') as f:
                            f.write(clean_content)
                            logger.error(f"Saved malformed JSON to: {f.name}")
                    except:
                        pass
                    
                    yield {
                        "event": "error",
                        "data": {"error": "Failed to parse AI response"}
                    }

        except Exception as e:
            logger.error(f"Error in iterating presentation: {e}", exc_info=True)
            yield {
                "event": "error",
                "data": {"error": str(e)}
            }

