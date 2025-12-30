from flask import Blueprint, request, jsonify, Response, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import db, Presentation, User
from app.services.ai_service import AIService
from datetime import datetime
import json
import logging

logger = logging.getLogger(__name__)

presentations_bp = Blueprint('presentations', __name__, url_prefix='/api')

# Initialize AI service
ai_service = AIService()


def calculate_estimated_tokens(slide_count: int, detail_level: str, tonality: str) -> float:
    """
    Calculate estimated slide tokens required for a presentation.
    1 slide token = 1000 AI tokens
    """
    # Base token cost per slide (in slide tokens)
    base_token_per_slide = 2.5  # ~2500 AI tokens per slide
    
    # Adjust based on detail level
    if detail_level == 'concise':
        base_token_per_slide = 1.5  # ~1500 AI tokens per slide
    elif detail_level == 'detailed':
        base_token_per_slide = 4.0  # ~4000 AI tokens per slide
    # balanced stays at 2.5
    
    # Minor adjustment for tonality complexity
    tonality_multiplier = 1.0
    if tonality == 'casual':
        tonality_multiplier = 0.9
    elif tonality == 'technical':
        tonality_multiplier = 1.1
    # professional stays at 1.0
    
    # Calculate total estimated tokens
    estimated_tokens = slide_count * base_token_per_slide * tonality_multiplier
    return round(estimated_tokens, 1)


def deduct_user_tokens_sync(app, user_id, tokens_used):
    """
    Synchronously deduct slide tokens from user based on AI token usage.
    1 slide token = 1000 AI tokens
    Returns the number of slide tokens deducted and remaining balance.
    """
    try:
        with app.app_context():
            user = db.session.get(User, user_id)
            if user:
                slide_tokens_deducted = user.deduct_slide_tokens(tokens_used)
                db.session.commit()
                logger.info(f"Deducted {slide_tokens_deducted:.2f} slide tokens from user {user_id}. Remaining: {user.slide_tokens:.2f}")
                return {
                    'success': True,
                    'slide_tokens_deducted': slide_tokens_deducted,
                    'slide_tokens_remaining': user.slide_tokens
                }
            else:
                logger.error(f"User {user_id} not found for token deduction")
                return {'success': False, 'error': 'User not found'}
    except Exception as e:
        logger.error(f"Error deducting tokens for user {user_id}: {e}")
        try:
            with app.app_context():
                db.session.rollback()
        except:
            pass
        return {'success': False, 'error': str(e)}


def save_presentation_sync(app, presentation_id, data, prompt=None):
    """
    Synchronously save presentation data to database.
    This function creates its own app context to ensure DB operations work.
    """
    try:
        with app.app_context():
            pres = db.session.get(Presentation, presentation_id)
            if pres:
                if data.get('title'):
                    pres.title = data.get('title', pres.title)
                if prompt:
                    pres.prompt = prompt
                pres.set_slides_data(data)
                pres.updated_at = datetime.utcnow()
                db.session.commit()
                logger.info(f"Saved presentation {presentation_id} with {len(data.get('slides', []))} slides")
                return True
            else:
                logger.error(f"Presentation {presentation_id} not found")
                return False
    except Exception as e:
        logger.error(f"Error saving presentation {presentation_id}: {e}")
        try:
            with app.app_context():
                db.session.rollback()
        except:
            pass
        return False


@presentations_bp.route('/generate-presentation-stream', methods=['POST'])
@jwt_required()
def generate_presentation_stream():
    """Generate a new presentation with streaming"""
    try:
        current_user_id = get_jwt_identity()
        # Convert to int since identity is stored as string
        try:
            user_id = int(current_user_id) if isinstance(current_user_id, str) else current_user_id
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid user ID'}), 422
        
        # Check if user exists
        user = db.session.get(User, user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be JSON'}), 400
            
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON data'}), 400
            
        prompt = data.get('prompt')
        slide_count = data.get('slideCount', 8)
        detail_level = data.get('detailLevel', 'balanced')
        tonality = data.get('tonality', 'professional')
        
        # Calculate estimated tokens based on parameters
        estimated_tokens = calculate_estimated_tokens(slide_count, detail_level, tonality)
        
        # Check if user has sufficient slide tokens
        if user.slide_tokens < estimated_tokens:
            return jsonify({
                'error': 'Insufficient slide tokens',
                'slide_tokens_remaining': user.slide_tokens,
                'slide_tokens_required': estimated_tokens
            }), 402  # Payment Required

        if not prompt:
            return jsonify({'error': 'Prompt is required'}), 400

        # Create presentation record FIRST with placeholder data
        presentation = Presentation(
            user_id=user_id,
            title='Generating...',
            prompt=prompt
        )
        presentation.set_slides_data({'slides': [], 'theme': 'default', 'title': 'Generating...', 'totalSlides': 0})
        db.session.add(presentation)
        db.session.commit()
        
        presentation_id = presentation.id
        app = current_app._get_current_object()
        
        logger.info(f"Created presentation {presentation_id} for user {user_id}")

        def generate():
            all_slides = []
            theme = 'default'
            title = 'Untitled Presentation'
            tokens_used = 0
            
            # Send the presentation ID immediately so frontend knows it
            yield f"event: created\n"
            yield f"data: {json.dumps({'presentation_id': presentation_id})}\n\n"
            
            try:
                for event in ai_service.generate_presentation_stream(prompt, slide_count, detail_level, tonality):
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
                        # Use complete data if available
                        if event_data.get('slides'):
                            all_slides = event_data.get('slides')
                        if event_data.get('theme'):
                            theme = event_data.get('theme')
                        if event_data.get('title'):
                            title = event_data.get('title')
                        # Get tokens used from complete event
                        tokens_used = event_data.get('tokens_used', 0)
                    
                    # Stream the event to frontend
                    yield f"event: {event_type}\n"
                    yield f"data: {json.dumps(event_data)}\n\n"
                
                # After streaming completes, save final data
                final_data = {
                    'slides': all_slides,
                    'theme': theme,
                    'title': title,
                    'totalSlides': len(all_slides)
                }
                
                if save_presentation_sync(app, presentation_id, final_data, prompt):
                    # Deduct slide tokens based on tokens used
                    token_result = deduct_user_tokens_sync(app, user_id, tokens_used)
                    
                    yield f"event: saved\n"
                    yield f"data: {json.dumps({'presentation_id': presentation_id, 'success': True, 'tokens_used': tokens_used, **token_result})}\n\n"
                else:
                    yield f"event: save_error\n"
                    yield f"data: {json.dumps({'error': 'Failed to save presentation'})}\n\n"
                    
            except Exception as e:
                logger.error(f"Error during generation: {e}")
                yield f"event: error\n"
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return Response(
            generate(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no'
            }
        )
        
    except Exception as e:
        logger.error(f"Error in generate_presentation_stream: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@presentations_bp.route('/iterate-presentation-stream', methods=['POST'])
@jwt_required()
def iterate_presentation_stream():
    """Iterate on an existing presentation - updates in place"""
    try:
        current_user_id = get_jwt_identity()
        # Convert to int since identity is stored as string
        try:
            user_id = int(current_user_id) if isinstance(current_user_id, str) else current_user_id
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid user ID'}), 422
        
        # Check if user exists
        user = db.session.get(User, user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be JSON'}), 400
            
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON data'}), 400
            
        prompt = data.get('prompt')
        presentation_id = data.get('parentPresentationId')
        slide_count = data.get('slideCount', 8)
        detail_level = data.get('detailLevel', 'balanced')
        tonality = data.get('tonality', 'professional')
        
        # Calculate estimated tokens based on parameters
        estimated_tokens = calculate_estimated_tokens(slide_count, detail_level, tonality)
        
        # Check if user has sufficient slide tokens
        if user.slide_tokens < estimated_tokens:
            return jsonify({
                'error': 'Insufficient slide tokens',
                'slide_tokens_remaining': user.slide_tokens,
                'slide_tokens_required': estimated_tokens
            }), 402  # Payment Required

        if not prompt:
            return jsonify({'error': 'Prompt is required'}), 400
        
        if not presentation_id:
            return jsonify({'error': 'Presentation ID is required'}), 400

        # Get the existing presentation
        presentation = Presentation.query.filter_by(
            id=presentation_id,
            user_id=user_id
        ).first()
        
        if not presentation:
            return jsonify({'error': 'Presentation not found'}), 404
        
        # Get current data for AI context
        parent_data = presentation.get_slides_data()
        app = current_app._get_current_object()
        
        logger.info(f"Starting iteration on presentation {presentation_id}")

        def generate():
            all_slides = []
            theme = parent_data.get('theme', 'default')
            title = parent_data.get('title', 'Untitled Presentation')
            tokens_used = 0
            
            try:
                for event in ai_service.iterate_presentation_stream(prompt, parent_data, slide_count, detail_level, tonality):
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
                        # Use complete data if available
                        if event_data.get('slides'):
                            all_slides = event_data.get('slides')
                        if event_data.get('theme'):
                            theme = event_data.get('theme')
                        if event_data.get('title'):
                            title = event_data.get('title')
                        # Get tokens used from complete event
                        tokens_used = event_data.get('tokens_used', 0)
                    
                    # Stream the event to frontend
                    yield f"event: {event_type}\n"
                    yield f"data: {json.dumps(event_data)}\n\n"
                
                # After streaming completes, save final data (replaces existing)
                final_data = {
                    'slides': all_slides,
                    'theme': theme,
                    'title': title,
                    'totalSlides': len(all_slides)
                }
                
                if len(all_slides) > 0:
                    if save_presentation_sync(app, presentation_id, final_data, prompt):
                        # Deduct slide tokens based on tokens used
                        token_result = deduct_user_tokens_sync(app, user_id, tokens_used)
                        
                        logger.info(f"Successfully updated presentation {presentation_id} with {len(all_slides)} slides")
                        yield f"event: saved\n"
                        yield f"data: {json.dumps({'presentation_id': presentation_id, 'success': True, 'tokens_used': tokens_used, **token_result})}\n\n"
                    else:
                        yield f"event: save_error\n"
                        yield f"data: {json.dumps({'error': 'Failed to save presentation'})}\n\n"
                else:
                    logger.warning(f"No slides generated for presentation {presentation_id}")
                    yield f"event: save_error\n"
                    yield f"data: {json.dumps({'error': 'No slides were generated'})}\n\n"
                    
            except Exception as e:
                logger.error(f"Error during iteration: {e}")
                yield f"event: error\n"
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return Response(
            generate(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no'
            }
        )
        
    except Exception as e:
        logger.error(f"Error in iterate_presentation_stream: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@presentations_bp.route('/presentations/<int:presentation_id>/slides', methods=['PUT'])
@jwt_required()
def update_presentation_slides(presentation_id):
    """Update slides for a presentation - for manual edits, deletions, reordering"""
    try:
        current_user_id = get_jwt_identity()
        
        presentation = Presentation.query.filter_by(
            id=presentation_id,
            user_id=current_user_id
        ).first()
        
        if not presentation:
            return jsonify({
                'success': False,
                'error': 'Presentation not found'
            }), 404
        
        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON data'}), 400
        
        # Get current presentation data
        current_data = presentation.get_slides_data()
        
        # Update with new slides data
        if 'slides' in data:
            current_data['slides'] = data['slides']
            current_data['totalSlides'] = len(data['slides'])
        
        if 'title' in data:
            current_data['title'] = data['title']
            presentation.title = data['title']
        
        if 'theme' in data:
            current_data['theme'] = data['theme']
        
        presentation.set_slides_data(current_data)
        presentation.updated_at = datetime.utcnow()
        db.session.commit()
        
        logger.info(f"Updated presentation {presentation_id} slides")
        
        return jsonify({
            'success': True,
            'presentation': presentation.to_dict(include_slides=True)
        })
        
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error updating presentation slides: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@presentations_bp.route('/presentations/<int:presentation_id>/slides/<string:slide_id>', methods=['DELETE'])
@jwt_required()
def delete_slide(presentation_id, slide_id):
    """Delete a specific slide from a presentation"""
    try:
        current_user_id = get_jwt_identity()
        
        presentation = Presentation.query.filter_by(
            id=presentation_id,
            user_id=current_user_id
        ).first()
        
        if not presentation:
            return jsonify({
                'success': False,
                'error': 'Presentation not found'
            }), 404
        
        current_data = presentation.get_slides_data()
        slides = current_data.get('slides', [])
        
        # Find and remove the slide
        original_count = len(slides)
        slides = [s for s in slides if s.get('id') != slide_id]
        
        if len(slides) == original_count:
            return jsonify({
                'success': False,
                'error': 'Slide not found'
            }), 404
        
        current_data['slides'] = slides
        current_data['totalSlides'] = len(slides)
        
        presentation.set_slides_data(current_data)
        presentation.updated_at = datetime.utcnow()
        db.session.commit()
        
        logger.info(f"Deleted slide {slide_id} from presentation {presentation_id}")
        
        return jsonify({
            'success': True,
            'slides': slides,
            'totalSlides': len(slides)
        })
        
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error deleting slide: {e}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@presentations_bp.route('/presentations', methods=['GET'])
@jwt_required()
def get_presentations():
    """Get all presentations for the current user"""
    try:
        current_user_id = get_jwt_identity()
        
        presentations = Presentation.query.filter_by(user_id=current_user_id)\
            .order_by(Presentation.updated_at.desc())\
            .all()
        
        return jsonify({
            'success': True,
            'presentations': [p.to_dict(include_slides=False) for p in presentations]
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@presentations_bp.route('/presentations/<int:presentation_id>', methods=['GET'])
@jwt_required()
def get_presentation(presentation_id):
    """Get a specific presentation with full slide data"""
    try:
        current_user_id = get_jwt_identity()
        
        presentation = Presentation.query.filter_by(
            id=presentation_id,
            user_id=current_user_id
        ).first()
        
        if not presentation:
            return jsonify({
                'success': False,
                'error': 'Presentation not found'
            }), 404
        
        return jsonify({
            'success': True,
            'presentation': presentation.to_dict(include_slides=True)
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@presentations_bp.route('/presentations/<int:presentation_id>', methods=['DELETE'])
@jwt_required()
def delete_presentation(presentation_id):
    """Delete a specific presentation"""
    try:
        current_user_id = get_jwt_identity()
        
        presentation = Presentation.query.filter_by(
            id=presentation_id,
            user_id=current_user_id
        ).first()
        
        if not presentation:
            return jsonify({
                'success': False,
                'error': 'Presentation not found'
            }), 404
        
        db.session.delete(presentation)
        db.session.commit()
        
        logger.info(f"Deleted presentation {presentation_id}")
        
        return jsonify({
            'success': True,
            'message': 'Presentation deleted successfully'
        })
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@presentations_bp.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint (no auth required)"""
    return jsonify({
        'status': 'healthy',
        'message': 'SlideSage API is running'
    }), 200
