import json
import logging
import re
from typing import Generator
from app.config import Config

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
        """Process a single slide to ensure it has required fields and formatting"""
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

    def generate_presentation_stream(self, user_prompt: str, slide_count: int = 8, detail_level: str = 'balanced', tonality: str = 'professional') -> Generator[dict, None, None]:
        """Stream presentation generation, yielding each slide as it becomes available"""
        try:
            # Detail level definitions with examples
            detail_level_guide = {
                'brief': {
                    'description': 'Brief - Minimal content with key highlights only',
                    'example': 'Lists with 2-3 bullet points, short sentences (5-8 words), minimal descriptions'
                },
                'concise': {
                    'description': 'Concise - Essential information in compact form',
                    'example': 'Lists with 3-4 bullet points, concise sentences (8-12 words), brief explanations'
                },
                'balanced': {
                    'description': 'Balanced - Standard level of detail with clear explanations',
                    'example': 'Lists with 4-5 bullet points, complete sentences (12-15 words), adequate context and explanations'
                },
                'detailed': {
                    'description': 'Detailed - Comprehensive information with elaboration',
                    'example': 'Lists with 5-6 bullet points, detailed sentences (15-20 words), thorough explanations with supporting details'
                },
                'comprehensive': {
                    'description': 'Comprehensive - In-depth coverage with extensive details',
                    'example': 'Lists with 6-8 bullet points, extensive sentences (20+ words), deep explanations with examples, context, and implications'
                }
            }
            
            # Tonality definitions with examples
            tonality_guide = {
                'professional': {
                    'description': 'Professional - Business-appropriate, objective, and polished',
                    'example': 'Use formal language, industry terminology, data-driven statements. Example: "Our analysis demonstrates a significant improvement in operational efficiency."'
                },
                'casual': {
                    'description': 'Casual - Relaxed, conversational, and approachable',
                    'example': 'Use everyday language, contractions, and friendly tone. Example: "We\'ve seen some great results that we\'re excited to share with you."'
                },
                'enthusiastic': {
                    'description': 'Enthusiastic - Energetic, passionate, and motivational',
                    'example': 'Use dynamic verbs, exclamations, and inspiring language. Example: "This breakthrough innovation is transforming the way we work!"'
                },
                'persuasive': {
                    'description': 'Persuasive - Compelling, benefit-focused, and action-oriented',
                    'example': 'Use strong calls-to-action, benefits-driven language, and compelling arguments. Example: "Imagine the impact: 40% faster results with half the effort. That\'s the power of our solution."'
                }
            }
            
            # Get selected detail level and tonality guides
            selected_detail = detail_level_guide.get(detail_level, detail_level_guide['balanced'])
            selected_tonality = tonality_guide.get(tonality, tonality_guide['professional'])
            
            # Extract values to avoid nested f-string issues
            detail_description = selected_detail['description']
            detail_example = selected_detail['example']
            tonality_description = selected_tonality['description']
            tonality_example = selected_tonality['example']
            
            system_prompt = """
        You are an expert presentation designer. Create comprehensive presentations with structured HTML, standardized IDs, data tables, and appropriate content.
        
        IMPORTANT: Analyze the content depth and create the APPROPRIATE number of slides (as many slides as requested by the user).
        
        CRITICAL JSON FORMATTING RULES:
        1. The response MUST be a single, valid JSON object
        2. NO additional text, markdown, or code blocks before or after the JSON
        3. NO comments within the JSON
        4. ALL strings must be properly escaped and enclosed in double quotes
        5. NO trailing commas
        6. NO single quotes for strings
        7. ALL HTML content must be properly escaped within the JSON strings
        
        CRITICAL HTML STRUCTURE REQUIREMENTS:
        - EVERY slide's HTML content MUST start with <div id="slide-content">
        - ALL content must be wrapped inside the slide-content div
        - This wrapper is essential for template styling to work properly
        - Never generate HTML without the slide-content wrapper
        
        STANDARDIZED HTML ID CONVENTIONS (MUST USE THESE EXACT IDs):
        - id="slide-content" - Main content area (div) - REQUIRED: ALL slides MUST start with <div id="slide-content">
        - id="slide-title" - Main slide title (h1/h2)
        - id="slide-subtitle" - Subtitle or secondary heading (h2/h3)
        - id="slide-list" - Lists (ul/ol)
        - id="slide-table" - Data tables (table)
        - id="slide-image" - Images (img)
        - id="slide-quote" - Quotes or emphasis (blockquote/div)
        - id="slide-description" - Descriptions or captions (p)
        - id="slide-header" - Header section (header/div)
        - id="slide-footer" - Footer section (footer/div)
        - id="slide-highlight" - Highlighted content (div/span)
        - id="slide-stats" - Statistical data (div)
        - id="slide-keypoint" - Key points (div)
        
        HTML TABLE GUIDELINES:
        - Use proper HTML table structure: <table><thead><tbody><tr><th><td>
        - Add id="slide-table" to all tables
        - Include meaningful headers in <thead>
        - Use <tbody> for data rows
        - Add class="data-table" for styling hooks
        - Include tables for: comparisons, statistics, schedules, specifications, etc.
        
        Required JSON structure (MUST match exactly):
        {
          "theme": "string", 
          "slides": [
            {
              "id": "string",
              "type": "string",
              "html": "string" (for regular slides)
            },
            {
              "id": "string",
              "type": "chart",
              "chartConfig": {
                "type": "bar|line|pie|doughnut|radar|polarArea",
                "title": "string",
                "description": "string",
                "data": {
                  "labels": ["string"],
                  "datasets": [
                    {
                      "label": "string",
                      "data": [numbers],
                      "backgroundColor": ["string"] or "string",
                      "borderColor": ["string"] or "string",
                      "borderWidth": number
                    }
                  ]
                },
                "options": {}
              }
            }
          ],
          "totalSlides": number
        }
        
        DETAIL LEVEL REQUIREMENT:
        """ + detail_description + """
        Example: """ + detail_example + """
        
        TONALITY REQUIREMENT:
        """ + tonality_description + """
        Example: """ + tonality_example + """
        
        Generate slides that are:
        - Well-structured with proper HTML and standardized IDs
        - Include relevant data tables using proper HTML structure
        - Include relevant data visualizations using charts
        - Follow the specified detail level: """ + detail_level + """
        - Match the specified tonality: """ + tonality + """
        - Professional and clear with consistent ID usage
        - Data-driven where appropriate
        - Template-ready with standardized element IDs
        """

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
                    resp = completion(model=f"{provider}/{model_name}", messages=messages, stream=True)
                else:
                    resp = completion(model=model_name, messages=messages, stream=True)
            except Exception as e:
                err_name = type(e).__name__
                logger.error("LiteLLM streaming completion failed (%s). provider=%s model=%s error=%s", err_name, provider, model_name, str(e))
                raise RuntimeError(f"LiteLLM streaming completion failed (provider={provider}, model={model_name}): {e}") from e

            # Accumulate the streamed content
            accumulated_content = ""
            slides_yielded = 0
            theme_yielded = False
            title_extracted = None
            
            # Yield initial event
            yield {"event": "start", "data": {"status": "generating"}}

            for chunk in resp:
                # Extract content from chunk
                chunk_content = ""
                if isinstance(chunk, dict):
                    choices = chunk.get("choices") or []
                    if choices:
                        delta = choices[0].get("delta") or {}
                        chunk_content = delta.get("content", "")
                else:
                    try:
                        if chunk.choices and chunk.choices[0].delta.content:
                            chunk_content = chunk.choices[0].delta.content
                    except Exception:
                        pass

                if chunk_content:
                    accumulated_content += chunk_content
                    
                    # Clean markdown code blocks if present
                    clean_content = accumulated_content.strip()
                    if clean_content.startswith('```json'):
                        clean_content = clean_content.replace('```json', '').replace('```', '').strip()
                    elif clean_content.startswith('```'):
                        clean_content = clean_content.replace('```', '').strip()
                    
                    # Try to extract theme if not yet yielded
                    if not theme_yielded:
                        theme_match = re.search(r'"theme"\s*:\s*"([^"]*)"', clean_content)
                        if theme_match:
                            theme_yielded = True
                            yield {"event": "theme", "data": {"theme": theme_match.group(1)}}
                    
                    # Try to extract complete slides using regex
                    # Look for complete slide objects in the slides array
                    slides_pattern = r'"slides"\s*:\s*\['
                    slides_match = re.search(slides_pattern, clean_content)
                    
                    if slides_match:
                        # Find all complete slide objects
                        slides_start = slides_match.end()
                        remaining = clean_content[slides_start:]
                        
                        # Parse complete slide objects
                        current_pos = 0
                        bracket_count = 0
                        slide_start = -1
                        in_string = False
                        escape_next = False
                        
                        extracted_slides = []
                        
                        for i, char in enumerate(remaining):
                            if escape_next:
                                escape_next = False
                                continue
                            if char == '\\':
                                escape_next = True
                                continue
                            if char == '"' and not escape_next:
                                in_string = not in_string
                                continue
                            if in_string:
                                continue
                            
                            if char == '{':
                                if bracket_count == 0:
                                    slide_start = i
                                bracket_count += 1
                            elif char == '}':
                                bracket_count -= 1
                                if bracket_count == 0 and slide_start >= 0:
                                    # Found a complete slide object
                                    slide_json = remaining[slide_start:i+1]
                                    try:
                                        slide_obj = json.loads(slide_json)
                                        extracted_slides.append(slide_obj)
                                    except json.JSONDecodeError:
                                        pass
                                    slide_start = -1
                            elif char == ']' and bracket_count == 0:
                                # End of slides array
                                break
                        
                        # Yield any new slides
                        for idx in range(slides_yielded, len(extracted_slides)):
                            slide = extracted_slides[idx]
                            processed_slide = self._process_slide(slide, idx)
                            if processed_slide:
                                # Extract title from first slide
                                if idx == 0 and title_extracted is None:
                                    if 'title' in slide and slide['title']:
                                        title_extracted = slide['title']
                                    elif 'html' in slide:
                                        html = slide['html']
                                        title_match = re.search(r'<h[12][^>]*id=["\']slide-title["\'][^>]*>([^<]+)</h[12]>', html)
                                        if title_match:
                                            title_extracted = title_match.group(1).strip()
                                        else:
                                            header_match = re.search(r'<h[12][^>]*>([^<]+)</h[12]>', html)
                                            if header_match:
                                                title_extracted = header_match.group(1).strip()
                                
                                slides_yielded += 1
                                yield {
                                    "event": "slide",
                                    "data": {
                                        "slide": processed_slide,
                                        "index": idx,
                                        "title": title_extracted
                                    }
                                }

            # Final processing of complete response
            clean_content = accumulated_content.strip()
            if clean_content.startswith('```json'):
                clean_content = clean_content.replace('```json', '').replace('```', '').strip()
            elif clean_content.startswith('```'):
                clean_content = clean_content.replace('```', '').strip()

            try:
                parsed_content = json.loads(clean_content)
                
                # Process any remaining slides that weren't yielded during streaming
                if 'slides' in parsed_content:
                    for idx in range(slides_yielded, len(parsed_content['slides'])):
                        slide = parsed_content['slides'][idx]
                        processed_slide = self._process_slide(slide, idx)
                        if processed_slide:
                            slides_yielded += 1
                            yield {
                                "event": "slide",
                                "data": {
                                    "slide": processed_slide,
                                    "index": idx,
                                    "title": title_extracted
                                }
                            }
                
                # Add title to parsed content
                if title_extracted:
                    parsed_content['title'] = title_extracted
                else:
                    parsed_content['title'] = 'Untitled Presentation'
                
                if 'slides' in parsed_content:
                    parsed_content['totalSlides'] = len(parsed_content['slides'])
                
                # Yield completion event with full presentation data
                yield {
                    "event": "complete",
                    "data": parsed_content
                }
                
            except json.JSONDecodeError as e:
                logger.error(f"JSON parsing error in stream: {e}")
                logger.error(f"Content: {clean_content}")
                yield {
                    "event": "error",
                    "data": {"error": "Failed to parse AI response"}
                }

        except Exception as e:
            logger.error(f"Error in streaming presentation: {e}")
            yield {
                "event": "error",
                "data": {"error": str(e)}
            }

    def iterate_presentation_stream(self, user_prompt: str, previous_presentation: dict, slide_count: int = 8, detail_level: str = 'balanced', tonality: str = 'professional') -> Generator[dict, None, None]:
        """Stream presentation iteration based on previous output, yielding each slide as it becomes available"""
        try:
            # Detail level definitions with examples
            detail_level_guide = {
                'brief': {
                    'description': 'Brief - Minimal content with key highlights only',
                    'example': 'Lists with 2-3 bullet points, short sentences (5-8 words), minimal descriptions'
                },
                'concise': {
                    'description': 'Concise - Essential information in compact form',
                    'example': 'Lists with 3-4 bullet points, concise sentences (8-12 words), brief explanations'
                },
                'balanced': {
                    'description': 'Balanced - Standard level of detail with clear explanations',
                    'example': 'Lists with 4-5 bullet points, complete sentences (12-15 words), adequate context and explanations'
                },
                'detailed': {
                    'description': 'Detailed - Comprehensive information with elaboration',
                    'example': 'Lists with 5-6 bullet points, detailed sentences (15-20 words), thorough explanations with supporting details'
                },
                'comprehensive': {
                    'description': 'Comprehensive - In-depth coverage with extensive details',
                    'example': 'Lists with 6-8 bullet points, extensive sentences (20+ words), deep explanations with examples, context, and implications'
                }
            }
            
            # Tonality definitions with examples
            tonality_guide = {
                'professional': {
                    'description': 'Professional - Business-appropriate, objective, and polished',
                    'example': 'Use formal language, industry terminology, data-driven statements. Example: "Our analysis demonstrates a significant improvement in operational efficiency."'
                },
                'casual': {
                    'description': 'Casual - Relaxed, conversational, and approachable',
                    'example': 'Use everyday language, contractions, and friendly tone. Example: "We\'ve seen some great results that we\'re excited to share with you."'
                },
                'enthusiastic': {
                    'description': 'Enthusiastic - Energetic, passionate, and motivational',
                    'example': 'Use dynamic verbs, exclamations, and inspiring language. Example: "This breakthrough innovation is transforming the way we work!"'
                },
                'persuasive': {
                    'description': 'Persuasive - Compelling, benefit-focused, and action-oriented',
                    'example': 'Use strong calls-to-action, benefits-driven language, and compelling arguments. Example: "Imagine the impact: 40% faster results with half the effort. That\'s the power of our solution."'
                }
            }
            
            # Get selected detail level and tonality guides
            selected_detail = detail_level_guide.get(detail_level, detail_level_guide['balanced'])
            selected_tonality = tonality_guide.get(tonality, tonality_guide['professional'])
            
            # Extract values to avoid nested f-string issues
            detail_description = selected_detail['description']
            detail_example = selected_detail['example']
            tonality_description = selected_tonality['description']
            tonality_example = selected_tonality['example']
            
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
            
            system_prompt = """
        You are an expert presentation designer iterating on an existing presentation. Create comprehensive presentations with structured HTML, standardized IDs, data tables, and appropriate content.
        
        IMPORTANT: You are ITERATING on an existing presentation based on user feedback. The user will provide specific instructions on how to modify, enhance, or adjust the presentation.
        
        CRITICAL JSON FORMATTING RULES:
        1. The response MUST be a single, valid JSON object
        2. NO additional text, markdown, or code blocks before or after the JSON
        3. NO comments within the JSON
        4. ALL strings must be properly escaped and enclosed in double quotes
        5. NO trailing commas
        6. NO single quotes for strings
        7. ALL HTML content must be properly escaped within the JSON strings
        
        CRITICAL HTML STRUCTURE REQUIREMENTS:
        - EVERY slide's HTML content MUST start with <div id="slide-content">
        - ALL content must be wrapped inside the slide-content div
        - This wrapper is essential for template styling to work properly
        - Never generate HTML without the slide-content wrapper
        
        STANDARDIZED HTML ID CONVENTIONS (MUST USE THESE EXACT IDs):
        - id="slide-content" - Main content area (div) - REQUIRED: ALL slides MUST start with <div id="slide-content">
        - id="slide-title" - Main slide title (h1/h2)
        - id="slide-subtitle" - Subtitle or secondary heading (h2/h3)
        - id="slide-list" - Lists (ul/ol)
        - id="slide-table" - Data tables (table)
        - id="slide-image" - Images (img)
        - id="slide-quote" - Quotes or emphasis (blockquote/div)
        - id="slide-description" - Descriptions or captions (p)
        - id="slide-header" - Header section (header/div)
        - id="slide-footer" - Footer section (footer/div)
        - id="slide-highlight" - Highlighted content (div/span)
        - id="slide-stats" - Statistical data (div)
        - id="slide-keypoint" - Key points (div)
        
        HTML TABLE GUIDELINES:
        - Use proper HTML table structure: <table><thead><tbody><tr><th><td>
        - Add id="slide-table" to all tables
        - Include meaningful headers in <thead>
        - Use <tbody> for data rows
        - Add class="data-table" for styling hooks
        - Include tables for: comparisons, statistics, schedules, specifications, etc.
        
        Required JSON structure (MUST match exactly):
        {
          "theme": "string", 
          "slides": [
            {
              "id": "string",
              "type": "string",
              "html": "string" (for regular slides)
            },
            {
              "id": "string",
              "type": "chart",
              "chartConfig": {
                "type": "bar|line|pie|doughnut|radar|polarArea",
                "title": "string",
                "description": "string",
                "data": {
                  "labels": ["string"],
                  "datasets": [
                    {
                      "label": "string",
                      "data": [numbers],
                      "backgroundColor": ["string"] or "string",
                      "borderColor": ["string"] or "string",
                      "borderWidth": number
                    }
                  ]
                },
                "options": {}
              }
            }
          ],
          "totalSlides": number
        }
        
        DETAIL LEVEL REQUIREMENT:
        """ + detail_description + """
        Example: """ + detail_example + """
        
        TONALITY REQUIREMENT:
        """ + tonality_description + """
        Example: """ + tonality_example + """
        
        ITERATION INSTRUCTIONS:
        - Analyze the previous presentation content carefully
        - Apply the user's specific modifications, enhancements, or changes
        - Maintain consistency with the original theme unless instructed otherwise
        - Keep slides that are still relevant unless instructed to remove them
        - Add, modify, or remove slides based on the user's instructions
        - Ensure all slides follow the specified detail level: """ + detail_level + """
        - Match the specified tonality: """ + tonality + """
        """

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
                    resp = completion(model=f"{provider}/{model_name}", messages=messages, stream=True)
                else:
                    resp = completion(model=model_name, messages=messages, stream=True)
            except Exception as e:
                err_name = type(e).__name__
                logger.error("LiteLLM iteration streaming completion failed (%s). provider=%s model=%s error=%s", err_name, provider, model_name, str(e))
                raise RuntimeError(f"LiteLLM iteration streaming completion failed (provider={provider}, model={model_name}): {e}") from e

            # Accumulate the streamed content
            accumulated_content = ""
            slides_yielded = 0
            theme_yielded = False
            title_extracted = None
            
            # Yield initial event
            yield {"event": "start", "data": {"status": "generating"}}

            for chunk in resp:
                # Extract content from chunk
                chunk_content = ""
                if isinstance(chunk, dict):
                    choices = chunk.get("choices") or []
                    if choices:
                        delta = choices[0].get("delta") or {}
                        chunk_content = delta.get("content", "")
                else:
                    try:
                        if chunk.choices and chunk.choices[0].delta.content:
                            chunk_content = chunk.choices[0].delta.content
                    except Exception:
                        pass

                if chunk_content:
                    accumulated_content += chunk_content
                    
                    # Clean markdown code blocks if present
                    clean_content = accumulated_content.strip()
                    if clean_content.startswith('```json'):
                        clean_content = clean_content.replace('```json', '').replace('```', '').strip()
                    elif clean_content.startswith('```'):
                        clean_content = clean_content.replace('```', '').strip()
                    
                    # Try to extract theme if not yet yielded
                    if not theme_yielded:
                        theme_match = re.search(r'"theme"\s*:\s*"([^"]*)"', clean_content)
                        if theme_match:
                            theme_yielded = True
                            yield {"event": "theme", "data": {"theme": theme_match.group(1)}}
                    
                    # Try to extract complete slides using regex
                    # Look for complete slide objects in the slides array
                    slides_pattern = r'"slides"\s*:\s*\['
                    slides_match = re.search(slides_pattern, clean_content)
                    
                    if slides_match:
                        # Find all complete slide objects
                        slides_start = slides_match.end()
                        remaining = clean_content[slides_start:]
                        
                        # Parse complete slide objects
                        current_pos = 0
                        bracket_count = 0
                        slide_start = -1
                        in_string = False
                        escape_next = False
                        
                        extracted_slides = []
                        
                        for i, char in enumerate(remaining):
                            if escape_next:
                                escape_next = False
                                continue
                            if char == '\\':
                                escape_next = True
                                continue
                            if char == '"' and not escape_next:
                                in_string = not in_string
                                continue
                            if in_string:
                                continue
                            
                            if char == '{':
                                if bracket_count == 0:
                                    slide_start = i
                                bracket_count += 1
                            elif char == '}':
                                bracket_count -= 1
                                if bracket_count == 0 and slide_start >= 0:
                                    # Found a complete slide object
                                    slide_json = remaining[slide_start:i+1]
                                    try:
                                        slide_obj = json.loads(slide_json)
                                        extracted_slides.append(slide_obj)
                                    except json.JSONDecodeError:
                                        pass
                                    slide_start = -1
                            elif char == ']' and bracket_count == 0:
                                # End of slides array
                                break
                        
                        # Yield any new slides
                        for idx in range(slides_yielded, len(extracted_slides)):
                            slide = extracted_slides[idx]
                            processed_slide = self._process_slide(slide, idx)
                            if processed_slide:
                                # Extract title from first slide
                                if idx == 0 and title_extracted is None:
                                    if 'title' in slide and slide['title']:
                                        title_extracted = slide['title']
                                    elif 'html' in slide:
                                        html = slide['html']
                                        title_match = re.search(r'<h[12][^>]*id=["\']slide-title["\'][^>]*>([^<]+)</h[12]>', html)
                                        if title_match:
                                            title_extracted = title_match.group(1).strip()
                                        else:
                                            header_match = re.search(r'<h[12][^>]*>([^<]+)</h[12]>', html)
                                            if header_match:
                                                title_extracted = header_match.group(1).strip()
                                
                                slides_yielded += 1
                                yield {
                                    "event": "slide",
                                    "data": {
                                        "slide": processed_slide,
                                        "index": idx,
                                        "title": title_extracted
                                    }
                                }

            # Final processing of complete response
            clean_content = accumulated_content.strip()
            if clean_content.startswith('```json'):
                clean_content = clean_content.replace('```json', '').replace('```', '').strip()
            elif clean_content.startswith('```'):
                clean_content = clean_content.replace('```', '').strip()

            try:
                parsed_content = json.loads(clean_content)
                
                # Process any remaining slides that weren't yielded during streaming
                if 'slides' in parsed_content:
                    for idx in range(slides_yielded, len(parsed_content['slides'])):
                        slide = parsed_content['slides'][idx]
                        processed_slide = self._process_slide(slide, idx)
                        if processed_slide:
                            slides_yielded += 1
                            yield {
                                "event": "slide",
                                "data": {
                                    "slide": processed_slide,
                                    "index": idx,
                                    "title": title_extracted
                                }
                            }
                
                # Add title to parsed content
                if title_extracted:
                    parsed_content['title'] = title_extracted
                else:
                    parsed_content['title'] = 'Untitled Presentation'
                
                if 'slides' in parsed_content:
                    parsed_content['totalSlides'] = len(parsed_content['slides'])
                
                # Yield completion event with full presentation data
                yield {
                    "event": "complete",
                    "data": parsed_content
                }
                
            except json.JSONDecodeError as e:
                logger.error(f"JSON parsing error in iteration stream: {e}")
                logger.error(f"Content: {clean_content}")
                yield {
                    "event": "error",
                    "data": {"error": "Failed to parse AI response"}
                }

        except Exception as e:
            logger.error(f"Error in iterating presentation: {e}")
            yield {
                "event": "error",
                "data": {"error": str(e)}
            }

