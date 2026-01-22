"""
Stream Processing Utilities
Handles streaming content extraction and slide parsing
"""
import json
import logging
import re
from typing import List, Dict, Any

logger = logging.getLogger(__name__)


class StreamProcessor:
    """Processes streaming AI responses to extract slides and metadata"""
    
    def __init__(self):
        self.accumulated_content = ""
        self.slides_yielded = 0
        self.theme_yielded = False
        self.title_extracted = None
        self.total_tokens_used = 0
        self.chunk_count = 0
    
    def process_chunk(self, chunk: Any) -> str:
        """
        Extract content from a streaming chunk.
        
        Args:
            chunk: The chunk from the streaming response
            
        Returns:
            The text content extracted from the chunk
        """
        self.chunk_count += 1
        chunk_content = ""
        
        # Try to extract usage from final chunk
        if isinstance(chunk, dict):
            if chunk.get("usage"):
                self.total_tokens_used = chunk["usage"].get("total_tokens", 0)
                logger.info(f"Token usage detected: {self.total_tokens_used}")
            choices = chunk.get("choices") or []
            if choices:
                delta = choices[0].get("delta") or {}
                chunk_content = delta.get("content", "")
        else:
            try:
                # Check for usage in the chunk object
                if hasattr(chunk, 'usage') and chunk.usage:
                    self.total_tokens_used = getattr(chunk.usage, 'total_tokens', 0)
                    logger.info(f"Token usage detected: {self.total_tokens_used}")
                if hasattr(chunk, 'choices') and chunk.choices:
                    if len(chunk.choices) > 0 and hasattr(chunk.choices[0], 'delta'):
                        delta = chunk.choices[0].delta
                        if hasattr(delta, 'content') and delta.content:
                            chunk_content = delta.content
            except Exception as e:
                logger.warning(f"Error extracting chunk content: {e}")
        
        if self.chunk_count % 10 == 0:
            logger.info(f"Processed {self.chunk_count} chunks, accumulated {len(self.accumulated_content)} characters")
        
        return chunk_content
    
    def accumulate_content(self, chunk_content: str) -> None:
        """Add chunk content to accumulated content"""
        self.accumulated_content += chunk_content
    
    def get_clean_content(self) -> str:
        """Get content with markdown code blocks removed"""
        clean_content = self.accumulated_content.strip()
        if clean_content.startswith('```json'):
            clean_content = clean_content.replace('```json', '').replace('```', '').strip()
        elif clean_content.startswith('```'):
            clean_content = clean_content.replace('```', '').strip()
        return clean_content
    
    def extract_theme(self) -> str | None:
        """Try to extract theme from accumulated content"""
        if self.theme_yielded:
            return None
        
        clean_content = self.get_clean_content()
        theme_match = re.search(r'"theme"\s*:\s*"([^"]*)"', clean_content)
        if theme_match:
            self.theme_yielded = True
            return theme_match.group(1)
        return None
    
    def extract_slides(self) -> List[tuple[int, Dict[str, Any]]]:
        """
        Extract complete slide objects from accumulated content.
        
        Returns:
            List of tuples containing (index, slide_dict) for newly extracted slides
        """
        clean_content = self.get_clean_content()
        
        # Look for complete slide objects in the slides array
        slides_pattern = r'"slides"\s*:\s*\['
        slides_match = re.search(slides_pattern, clean_content)
        
        if not slides_match:
            return []
        
        # Find all complete slide objects
        slides_start = slides_match.end()
        remaining = clean_content[slides_start:]
        
        # Parse complete slide objects
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
        
        # Return only newly extracted slides with their indices
        start_idx = self.slides_yielded
        new_slides = extracted_slides[self.slides_yielded:]
        self.slides_yielded = len(extracted_slides)
        
        return [(start_idx + i, slide) for i, slide in enumerate(new_slides)]
    
    def extract_title_from_slide(self, slide: Dict[str, Any]) -> str | None:
        """
        Extract title from a slide.
        
        Args:
            slide: The slide dictionary
            
        Returns:
            Extracted title or None
        """
        if self.title_extracted:
            return self.title_extracted
        
        if 'title' in slide and slide['title']:
            self.title_extracted = slide['title']
        elif 'html' in slide:
            html = slide['html']
            title_match = re.search(r'<h[12][^>]*id=["\']slide-title["\'][^>]*>([^<]+)</h[12]>', html)
            if title_match:
                self.title_extracted = title_match.group(1).strip()
            else:
                header_match = re.search(r'<h[12][^>]*>([^<]+)</h[12]>', html)
                if header_match:
                    self.title_extracted = header_match.group(1).strip()
        
        return self.title_extracted
    
    def clean_final_content(self) -> str:
        """
        Clean the final accumulated content, removing markdown code blocks.
        
        Returns:
            Cleaned content string
        """
        clean_content = self.accumulated_content.strip()
        if clean_content.startswith('```json'):
            clean_content = clean_content.replace('```json', '', 1).strip()
            if clean_content.endswith('```'):
                clean_content = clean_content.rsplit('```', 1)[0].strip()
        elif clean_content.startswith('```'):
            clean_content = clean_content.replace('```', '', 1).strip()
            if clean_content.endswith('```'):
                clean_content = clean_content.rsplit('```', 1)[0].strip()
        
        return clean_content
