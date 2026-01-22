"""
JSON Recovery Utilities
Handles malformed JSON recovery for AI-generated responses
"""
import json
import logging
import tempfile

logger = logging.getLogger(__name__)


class JSONRecoveryError(Exception):
    """Exception raised when JSON recovery fails"""
    pass


def recover_json(content: str, error: json.JSONDecodeError) -> dict:
    """
    Attempt to recover valid JSON from malformed content.
    
    Strategies:
    1. Truncate at error position and close structures properly
    2. Balance unclosed brackets and braces
    
    Args:
        content: The malformed JSON string
        error: The JSONDecodeError that was raised
        
    Returns:
        Recovered JSON as a dictionary
        
    Raises:
        JSONRecoveryError: If recovery fails
    """
    logger.error(f"JSON parsing error: {error}")
    logger.error(f"Content length: {len(content)}, First 500 chars: {content[:500]}")
    logger.error(f"Error position: line {error.lineno} column {error.colno} (char {error.pos})")
    
    # Show context around the error
    error_start = max(0, error.pos - 100)
    error_end = min(len(content), error.pos + 100)
    logger.error(f"Error context: ...{content[error_start:error_end]}...")
    
    # Strategy 1: Try to truncate at the error position and close properly
    try:
        fixed_content = _truncate_and_close(content, error.pos)
        parsed_content = json.loads(fixed_content)
        logger.info(f"Successfully parsed truncated JSON with {len(parsed_content.get('slides', []))} slides")
        return parsed_content
    except json.JSONDecodeError:
        logger.warning("Truncation strategy failed, trying brace balancing")
    
    # Strategy 2: Just try to balance braces
    try:
        fixed_content = _balance_braces(content)
        parsed_content = json.loads(fixed_content)
        logger.info(f"Successfully parsed fixed JSON with {len(parsed_content.get('slides', []))} slides")
        return parsed_content
    except json.JSONDecodeError as e:
        logger.error(f"Could not recover from JSON error: {e}")
        _save_malformed_json(content)
        raise JSONRecoveryError(f"All recovery strategies failed: {e}")


def _truncate_and_close(content: str, error_pos: int) -> str:
    """
    Truncate content at the last valid slide before the error position.
    
    Args:
        content: The JSON string to fix
        error_pos: Position where the error occurred
        
    Returns:
        Truncated and closed JSON string
    """
    content_before_error = content[:error_pos]
    
    # Find the last complete slide object by counting braces
    last_valid_pos = 0
    brace_count = 0
    bracket_count = 0
    in_string = False
    escape_next = False
    in_slides_array = False
    
    for i, char in enumerate(content_before_error):
        if escape_next:
            escape_next = False
            continue
        if char == '\\':
            escape_next = True
            continue
        if char == '"' and not escape_next:
            in_string = not in_string
            continue
        if not in_string:
            if char == '{':
                brace_count += 1
            elif char == '}':
                brace_count -= 1
                # Track when we complete a slide object (back to slides array level)
                if in_slides_array and brace_count == 2:  # 1 for root object + 1 for slides array
                    last_valid_pos = i + 1
            elif char == '[':
                bracket_count += 1
                # Check if this is the slides array
                if i > 10 and content_before_error[max(0, i-10):i].find('"slides"') != -1:
                    in_slides_array = True
            elif char == ']':
                bracket_count -= 1
    
    if last_valid_pos > 0:
        logger.info(f"Found last valid position at {last_valid_pos}")
        fixed_content = content_before_error[:last_valid_pos]
        
        # Close the slides array and main object
        fixed_content += '],"totalSlides":'
        # Count how many complete slides we have
        slide_count = fixed_content.count('"id":"slide-')
        fixed_content += str(slide_count) + '}'
        
        logger.info("Attempting to parse truncated JSON...")
        return fixed_content
    else:
        raise json.JSONDecodeError("Could not find valid truncation point", content, error_pos)


def _balance_braces(content: str) -> str:
    """
    Balance unclosed brackets and braces in the content.
    
    Args:
        content: The JSON string to fix
        
    Returns:
        Content with balanced braces
    """
    bracket_balance = content.count('[') - content.count(']')
    brace_balance = content.count('{') - content.count('}')
    
    logger.info(f"JSON balance: {bracket_balance} unclosed brackets, {brace_balance} unclosed braces")
    
    # Attempt to complete the JSON
    fixed_content = content
    if bracket_balance > 0:
        fixed_content += ']' * bracket_balance
    if brace_balance > 0:
        fixed_content += '}' * brace_balance
    
    logger.info("Attempting to parse fixed JSON...")
    return fixed_content


def _save_malformed_json(content: str) -> None:
    """Save malformed JSON to a temp file for debugging"""
    try:
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json', prefix='litellm_error_') as f:
            f.write(content)
            logger.error(f"Saved malformed JSON to: {f.name}")
    except Exception as e:
        logger.warning(f"Could not save malformed JSON: {e}")
