"""Presentation API endpoints"""
from flask import Blueprint, request, jsonify, Response, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from marshmallow import ValidationError
import json
import logging

from app.schemas.presentations import (
    GeneratePresentationSchema,
    PresentationSchema,
    PresentationListSchema
)
from app.services.presentation_service import PresentationService
from app.utils.api_helpers import (
    get_current_user_id,
    format_sse_message,
    create_error_response,
    cleanup_presentation_on_error,
    map_error_to_status_code
)

logger = logging.getLogger(__name__)

presentations_bp = Blueprint('presentations', __name__, url_prefix='/api')
presentation_service = PresentationService()


@presentations_bp.errorhandler(ValidationError)
def handle_validation_error(e):
    """Handle marshmallow validation errors"""
    return create_error_response('Validation failed', 400, e.messages)


@presentations_bp.errorhandler(ValueError)
def handle_value_error(e):
    """Handle service layer value errors"""
    error_message = str(e)
    status_code = map_error_to_status_code(error_message)
    return create_error_response(error_message, status_code)


@presentations_bp.route('/generate-presentation-stream', methods=['POST'])
@jwt_required()
def generate_presentation_stream():
    """Generate a new presentation with streaming"""
    from flask import current_app
    
    # Capture the app reference BEFORE entering the generator
    # This is critical because current_app won't be available in the generator
    app = current_app._get_current_object()
    
    user_id = get_current_user_id()
    
    # Validate and deserialize input
    schema = GeneratePresentationSchema()
    data = schema.load(request.get_json())
    
    # Capture data needed for the generator
    topic = data['topic']
    slide_count = data['slide_count']
    detail_level = data.get('detail_level', 'balanced')
    tonality = data.get('tonality', 'professional')
    
    # Create initial presentation record
    from app.repositories.presentation_repository import PresentationRepository
    from app.models import db, Presentation
    
    presentation_repo = PresentationRepository()
    presentation = presentation_repo.create(
        user_id=user_id,
        title='Generating...',
        prompt=data.get('topic', 'Unknown topic'),
        slides_data={'slides': [], 'theme': 'default', 'title': 'Generating...'}
    )
    presentation_id = presentation.id
    
    def generate():
        with app.app_context():
            all_slides = []
            theme = 'default'
            title = 'Untitled Presentation'
            tokens_used = 0
            
            # Send presentation ID immediately
            yield f"event: created\n"
            yield f"data: {json.dumps({'presentation_id': presentation_id})}\n\n"
            
            try:
                # Stream presentation generation
                for event in presentation_service.generate_presentation_stream(
                    user_id=user_id,
                    topic=topic,
                    slide_count=slide_count,
                    detail_level=detail_level,
                    tonality=tonality
                ):
                    event_type = event.get('event', 'data')
                    event_data = event.get('data', {})
                    
                    # Accumulate data
                    if event_type == 'theme':
                        theme = event_data.get('theme', theme)
                    
                    if event_type == 'slide':
                        slide = event_data.get('slide')
                        if slide:
                            all_slides.append(slide)
                        if event_data.get('title'):
                            title = event_data.get('title')
                    
                    if event_type == 'complete':
                        if event_data.get('slides'):
                            all_slides = event_data.get('slides')
                        if event_data.get('theme'):
                            theme = event_data.get('theme')
                        if event_data.get('title'):
                            title = event_data.get('title')
                        tokens_used = event_data.get('tokens_used', 0)
                    
                    # Stream event to frontend
                    yield f"event: {event_type}\n"
                    yield f"data: {json.dumps(event_data)}\n\n"
                
                # Save final presentation data
                if all_slides:
                    final_data = {
                        'slides': all_slides,
                        'theme': theme,
                        'title': title,
                        'totalSlides': len(all_slides)
                    }
                    
                    # Update using the model's set_slides_data method
                    # Re-fetch the presentation to ensure we have it in this context
                    from app.models import Presentation, db
                    pres = db.session.get(Presentation, presentation_id)
                    if pres:
                        pres.title = title
                        pres.set_slides_data(final_data)
                        db.session.commit()
                        logger.info(f"Saved presentation {presentation_id} with {len(all_slides)} slides")
                    
                    yield format_sse_message("saved", {'presentation_id': presentation_id, 'success': True})
                else:
                    # No slides generated - delete the placeholder presentation
                    logger.error(f"No slides generated for presentation {presentation_id}")
                    cleanup_presentation_on_error(presentation_id)
                    yield format_sse_message("error", {'error': 'Failed to generate presentation content'})
                
            except ValueError as e:
                logger.error(f"Error during generation: {e}")
                cleanup_presentation_on_error(presentation_id)
                yield format_sse_message("error", {'error': str(e)})
            except Exception as e:
                logger.error(f"Unexpected error during generation: {e}")
                cleanup_presentation_on_error(presentation_id)
                yield format_sse_message("error", {'error': 'An unexpected error occurred'})
    
    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        }
    )


@presentations_bp.route('/presentations', methods=['GET'])
@jwt_required()
def get_presentations():
    """Get all presentations for the current user"""
    user_id = get_current_user_id()
    
    # Call service
    presentations = presentation_service.get_user_presentations(user_id)
    
    # Convert to dicts with slide_count
    presentations_data = []
    for p in presentations:
        slides_data = p.get_slides_data()
        presentations_data.append({
            'id': p.id,
            'title': p.title,
            'slide_count': len(slides_data.get('slides', [])) if slides_data else 0,
            'created_at': p.created_at,
            'updated_at': p.updated_at
        })
    
    # Serialize response
    schema = PresentationListSchema(many=True)
    return jsonify({'presentations': schema.dump(presentations_data)}), 200


@presentations_bp.route('/presentations/<int:presentation_id>', methods=['GET'])
@jwt_required()
def get_presentation(presentation_id):
    """Get a specific presentation with full slide data"""
    user_id = get_current_user_id()
    
    # Call service
    presentation = presentation_service.get_presentation(presentation_id, user_id)
    
    # Get slides data
    slides_data = presentation.get_slides_data()
    
    # Prepare data for serialization
    presentation_data = {
        'id': presentation.id,
        'user_id': presentation.user_id,
        'title': presentation.title,
        'prompt': presentation.prompt,
        'slide_count': len(slides_data.get('slides', [])) if slides_data else 0,
        'slides': slides_data,  # Full slide data
        'slides_data': slides_data,  # Also include as slides_data for compatibility
        'created_at': presentation.created_at,
        'updated_at': presentation.updated_at
    }
    
    # Serialize response
    schema = PresentationSchema()
    return jsonify({'presentation': schema.dump(presentation_data)}), 200


@presentations_bp.route('/presentations/<int:presentation_id>', methods=['DELETE'])
@jwt_required()
def delete_presentation(presentation_id):
    """Delete a specific presentation"""
    user_id = get_current_user_id()
    
    # Call service
    presentation_service.delete_presentation(presentation_id, user_id)
    
    return jsonify({'message': 'Presentation deleted successfully'}), 200


@presentations_bp.route('/presentations/cleanup', methods=['POST'])
@jwt_required()
def cleanup_incomplete_presentations():
    """Delete all incomplete presentations (Generating...) for the current user"""
    user_id = get_current_user_id()
    
    from app.models import Presentation, db
    
    # Find all presentations with title "Generating..." or empty slides
    incomplete = Presentation.query.filter_by(user_id=user_id, title='Generating...').all()
    
    deleted_count = 0
    for pres in incomplete:
        slides_data = pres.get_slides_data()
        if not slides_data or not slides_data.get('slides') or len(slides_data.get('slides', [])) == 0:
            db.session.delete(pres)
            deleted_count += 1
    
    db.session.commit()
    
    return jsonify({
        'message': f'Cleaned up {deleted_count} incomplete presentations',
        'deleted_count': deleted_count
    }), 200


@presentations_bp.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'message': 'SlideSage API is running'
    }), 200
