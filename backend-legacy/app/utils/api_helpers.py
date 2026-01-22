"""
API Helper Utilities
Common helpers for API endpoints
"""
import json
import logging
from typing import Dict, Any
from flask import jsonify
from flask_jwt_extended import get_jwt_identity

logger = logging.getLogger(__name__)


def get_current_user_id() -> int:
    """
    Helper to get and convert current user ID from JWT.
    
    Returns:
        User ID as integer
        
    Raises:
        ValueError: If token format is invalid
    """
    current_user_id = get_jwt_identity()
    try:
        return int(current_user_id) if isinstance(current_user_id, str) else current_user_id
    except (ValueError, TypeError):
        raise ValueError('Invalid token format')


def format_sse_message(event: str, data: Dict[str, Any]) -> str:
    """
    Format a Server-Sent Events message.
    
    Args:
        event: The event type
        data: The data payload
        
    Returns:
        Formatted SSE message string
    """
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def create_error_response(message: str, status_code: int = 400, details: Any = None) -> tuple:
    """
    Create a standardized error response.
    
    Args:
        message: Error message
        status_code: HTTP status code
        details: Optional additional details
        
    Returns:
        Tuple of (response, status_code)
    """
    error_obj = {'error': {'message': message}}
    if details:
        error_obj['error']['details'] = details
    return jsonify(error_obj), status_code


def cleanup_presentation_on_error(presentation_id: int) -> None:
    """
    Delete a presentation when an error occurs during generation.
    
    Args:
        presentation_id: ID of the presentation to delete
    """
    try:
        from app.models import Presentation, db
        pres = db.session.get(Presentation, presentation_id)
        if pres:
            db.session.delete(pres)
            db.session.commit()
            logger.info(f"Cleaned up failed presentation {presentation_id}")
    except Exception as e:
        logger.error(f"Error cleaning up presentation {presentation_id}: {e}")


def map_error_to_status_code(error_message: str) -> int:
    """
    Map error messages to appropriate HTTP status codes.
    
    Args:
        error_message: The error message
        
    Returns:
        Appropriate HTTP status code
    """
    error_lower = error_message.lower()
    
    if 'not found' in error_lower:
        return 404
    elif 'unauthorized' in error_lower or 'forbidden' in error_lower:
        return 403
    elif 'insufficient tokens' in error_lower or 'payment' in error_lower:
        return 402  # Payment Required
    elif 'conflict' in error_lower or 'already exists' in error_lower:
        return 409
    else:
        return 400
