import json
import logging
from config import ConfigAI

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

    def generate_presentation_structure(self, user_prompt: str, slide_count: int = 8) -> dict:
        try:
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
        
        SLIDE TYPE EXAMPLES WITH PROPER IDs:
        
        TITLE SLIDE:
        <div id="slide-content">
          <header id="slide-header">
            <h1 id="slide-title">Main Presentation Title</h1>
            <h2 id="slide-subtitle">Compelling Subtitle</h2>
          </header>
          <div id="slide-description">
            <p>Brief presentation overview or tagline</p>
          </div>
        </div>
        
        CONTENT SLIDE WITH LIST:
        <div id="slide-content">
          <h2 id="slide-title">Section Title</h2>
          <h3 id="slide-subtitle">Key Points</h3>
          <ul id="slide-list">
            <li>First important point with detailed explanation</li>
            <li>Second crucial insight with supporting details</li>
            <li>Third key element with relevant context</li>
          </ul>
          <div id="slide-highlight">
            <p>Important note or takeaway message</p>
          </div>
        </div>
        
        DATA SLIDE WITH TABLE:
        <div id="slide-content">
          <h2 id="slide-title">Performance Metrics</h2>
          <h3 id="slide-subtitle">Quarterly Results Comparison</h3>
          <table id="slide-table" class="data-table">
            <thead>
              <tr>
                <th>Quarter</th>
                <th>Revenue ($M)</th>
                <th>Growth (%)</th>
                <th>Market Share (%)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Q1 2024</td>
                <td>125.5</td>
                <td>12.3</td>
                <td>18.7</td>
              </tr>
              <tr>
                <td>Q2 2024</td>
                <td>142.8</td>
                <td>13.8</td>
                <td>21.2</td>
              </tr>
              <tr>
                <td>Q3 2024</td>
                <td>158.9</td>
                <td>11.3</td>
                <td>23.1</td>
              </tr>
              <tr>
                <td>Q4 2024</td>
                <td>176.2</td>
                <td>10.9</td>
                <td>24.8</td>
              </tr>
            </tbody>
          </table>
          <div id="slide-description">
            <p>Consistent growth trajectory with expanding market presence</p>
          </div>
        </div>
        
        STATISTICS SLIDE:
        <div id="slide-content">
          <h2 id="slide-title">Key Statistics</h2>
          <div id="slide-stats">
            <div id="slide-highlight">
              <h3>85%</h3>
              <p id="slide-description">Customer Satisfaction Rate</p>
            </div>
            <div id="slide-keypoint">
              <h3>2.3M</h3>
              <p id="slide-description">Active Users Worldwide</p>
            </div>
          </div>
        </div>
        
        QUOTE/EMPHASIS SLIDE:
        <div id="slide-content">
          <h2 id="slide-title">Industry Insight</h2>
          <blockquote id="slide-quote">
            "Innovation distinguishes between a leader and a follower."
          </blockquote>
          <div id="slide-description">
            <p>- Steve Jobs, Apple Co-founder</p>
          </div>
        </div>
        
        IMAGE SLIDE:
        <div id="slide-content">
          <h2 id="slide-title">Visual Overview</h2>
          <img id="slide-image" src="https://example.com/chart.jpg" alt="Market analysis chart" />
          <div id="slide-description">
            <p>Comprehensive market analysis showing growth trends</p>
          </div>
        </div>
        
        WHEN TO INCLUDE TABLES:
        - Comparative data (features, prices, performance)
        - Financial information (budgets, revenue, costs)
        - Statistics and metrics
        - Schedules and timelines
        - Technical specifications
        - Survey results with numbers
        - Before/after comparisons
        - Product/service comparisons
        
        TABLE STYLING REQUIREMENTS:
        - Always use id="slide-table" 
        - Add class="data-table" for template styling
        - Use proper <thead> and <tbody> structure
        - Include meaningful column headers
        - Ensure data is realistic and relevant
        - Keep tables readable (max 6-8 columns)
        - Add descriptions below tables when needed
        
        CHART TYPES AND WHEN TO USE:
        - "bar": Comparing quantities across categories
        - "line": Showing trends over time
        - "pie": Showing parts of a whole (percentages)
        - "doughnut": Similar to pie but with center space
        - "radar": Comparing multiple variables
        - "polarArea": Similar to pie but with variable radius
        
        CONTENT SCALING RULES:
        - Always include tables when showing comparative data
        - Always include charts when showing trends/statistics
        - Simple topics: 5-8 slides (1-2 tables, 1-2 charts)
        - Medium complexity: 8-12 slides (2-3 tables, 2-3 charts)
        - Complex topics: 12-20+ slides (3-5 tables, 3-5 charts)
        
        Generate slides that are:
        - Well-structured with proper HTML and standardized IDs
        - Include relevant data tables using proper HTML structure
        - Include relevant data visualizations using charts
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

            model_setting = ConfigAI.LITELLM_MODEL

            provider = None
            model_name = model_setting
            if isinstance(model_setting, str) and '/' in model_setting:
              provider, model_name = model_setting.split('/', 1)

            logger.info("LiteLLM model_setting=%s", model_setting)
            logger.info("Parsed provider=%s, model_name=%s", provider, model_name)

            try:
              if provider:
                resp = completion(model=f"{provider}/{model_name}", messages=messages)
              else:
                resp = completion(model=model_name, messages=messages)
            except Exception as e:
              err_name = type(e).__name__
              logger.error("LiteLLM completion failed (%s). provider=%s model=%s error=%s", err_name, provider, model_name, str(e))
              raise RuntimeError(f"LiteLLM completion failed (provider={provider}, model={model_name}): {e}") from e

            content = None
            if isinstance(resp, dict):
                choices = resp.get("choices") or []
                if choices:
                    message = choices[0].get("message") or {}
                    content = message.get("content")
            else:
                try:
                    content = resp.choices[0].message.content
                except Exception:
                    content = str(resp)

            if content is None:
                raise RuntimeError("No content returned from LiteLLM completion")

            content = content.strip()
            if content.startswith('```json'):
                content = content.replace('```json', '').replace('```', '').strip()
            elif content.startswith('```'):
                content = content.replace('```', '').strip()

            parsed_content = json.loads(content)

            # Extract title from first slide and add it to the presentation
            extracted_title = "Untitled Presentation"
            if 'slides' in parsed_content and len(parsed_content['slides']) > 0:
                first_slide = parsed_content['slides'][0]
                if 'title' in first_slide and first_slide['title']:
                    extracted_title = first_slide['title']
                elif 'html' in first_slide:
                    # Extract from HTML
                    import re
                    html = first_slide['html']
                    # Try to find h1 or h2 with id="slide-title"
                    title_match = re.search(r'<h[12][^>]*id=["\']slide-title["\'][^>]*>([^<]+)</h[12]>', html)
                    if title_match:
                        extracted_title = title_match.group(1).strip()
                    else:
                        # Fallback: find any h1 or h2
                        header_match = re.search(r'<h[12][^>]*>([^<]+)</h[12]>', html)
                        if header_match:
                            extracted_title = header_match.group(1).strip()
            
            # Add the extracted title to the parsed content
            parsed_content['title'] = extracted_title

            if 'slides' in parsed_content:
                parsed_content['totalSlides'] = len(parsed_content['slides'])

            if 'slides' not in parsed_content or len(parsed_content.get('slides', [])) == 0:
                raise ValueError("Invalid or empty slides generated")

            for i, slide in enumerate(parsed_content['slides']):
                if not isinstance(slide, dict):
                    logger.warning(f"Invalid slide {i}, skipping")
                    continue

                slide['id'] = slide.get('id', f'slide-{i+1}')
                slide['type'] = slide.get('type', 'content')

                if slide['type'] == 'chart' and 'chartConfig' not in slide:
                    logger.warning(f"Chart slide {i} missing chartConfig, converting to content")
                    slide['type'] = 'content'
                    slide['html'] = '<div id="slide-content"><h2 id="slide-title">Data Visualization</h2><p id="slide-description">Chart data unavailable</p></div>'

                elif 'html' in slide and slide['html']:
                    html_content = slide['html'].strip()
                    if not html_content.startswith('<div id="slide-content">'):
                        slide['html'] = f'<div id="slide-content">{html_content}</div>'
                        logger.info(f"Added slide-content wrapper to slide {i}")

            logger.info(f"Generated {len(parsed_content['slides'])} slides successfully")
            return parsed_content

        except json.JSONDecodeError as e:
            logger.error(f"JSON parsing error: {e}")
            logger.error(f"Content: {content}")
            raise Exception("Failed to parse AI response")

        except Exception as e:
            logger.error(f"Error generating presentation: {e}")
            raise
