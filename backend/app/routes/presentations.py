from flask import Blueprint, request, jsonify, Response
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import db, Presentation
from app.services.ai_service import AIService
import json

presentations_bp = Blueprint('presentations', __name__, url_prefix='/api')

# Initialize AI service
ai_service = AIService()


@presentations_bp.route('/generate-presentation-stream', methods=['POST'])
@jwt_required()
def generate_presentation_stream():
    """Generate presentation with streaming - requires authentication"""
    try:
        # Get current user
        current_user_id = get_jwt_identity()
        
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be JSON'}), 400
            
        data = request.get_json()

        if not data:
            return jsonify({'error': 'Invalid JSON data'}), 400
            
        prompt = data.get('prompt')
        slide_count = data.get('slideCount', 8)
        detail_level = data.get('detailLevel', 'balanced')
        tonality = data.get('tonality', 'professional')

        if not prompt:
            return jsonify({'error': 'Prompt is required'}), 400

        def generate():
            presentation_data = None
            
            for event in ai_service.generate_presentation_stream(prompt, slide_count, detail_level, tonality):
                event_type = event.get('event', 'data')
                event_data = event.get('data', {})
                
                # Store complete presentation data for saving
                if event_type == 'complete':
                    presentation_data = event_data
                
                # Format as SSE
                yield f"event: {event_type}\n"
                yield f"data: {json.dumps(event_data)}\n\n"
            
            # Save to database after streaming completes
            if presentation_data and 'slides' in presentation_data:
                try:
                    from flask import current_app
                    with current_app.app_context():
                        title = presentation_data.get('title', 'Untitled Presentation')
                        presentation = Presentation(
                            user_id=current_user_id,
                            title=title,
                            prompt=prompt
                        )
                        presentation.set_slides_data(presentation_data)
                        db.session.add(presentation)
                        db.session.commit()
                        
                        # Send the presentation ID
                        yield f"event: saved\n"
                        yield f"data: {json.dumps({'presentation_id': presentation.id})}\n\n"
                except Exception as e:
                    yield f"event: save_error\n"
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
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@presentations_bp.route('/iterate-presentation-stream', methods=['POST'])
@jwt_required()
def iterate_presentation_stream():
    """Iterate on an existing presentation with streaming - requires authentication"""
    try:
        current_user_id = get_jwt_identity()
        
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be JSON'}), 400
            
        data = request.get_json()

        if not data:
            return jsonify({'error': 'Invalid JSON data'}), 400
            
        prompt = data.get('prompt')
        parent_presentation_id = data.get('parentPresentationId')
        slide_count = data.get('slideCount', 8)
        detail_level = data.get('detailLevel', 'balanced')
        tonality = data.get('tonality', 'professional')

        if not prompt:
            return jsonify({'error': 'Prompt is required'}), 400
        
        if not parent_presentation_id:
            return jsonify({'error': 'Parent presentation ID is required'}), 400

        # Get the parent presentation
        parent_presentation = Presentation.query.filter_by(
            id=parent_presentation_id,
            user_id=current_user_id
        ).first()
        
        if not parent_presentation:
            return jsonify({'error': 'Parent presentation not found'}), 404
        
        parent_data = parent_presentation.get_slides_data()

        def generate():
            presentation_data = None
            
            for event in ai_service.iterate_presentation_stream(prompt, parent_data, slide_count, detail_level, tonality):
                event_type = event.get('event', 'data')
                event_data = event.get('data', {})
                
                # Store complete presentation data for saving
                if event_type == 'complete':
                    presentation_data = event_data
                
                # Format as SSE
                yield f"event: {event_type}\n"
                yield f"data: {json.dumps(event_data)}\n\n"
            
            # Save to database after streaming completes
            if presentation_data and 'slides' in presentation_data:
                try:
                    from flask import current_app
                    with current_app.app_context():
                        title = presentation_data.get('title', 'Untitled Presentation')
                        presentation = Presentation(
                            user_id=current_user_id,
                            title=title,
                            prompt=prompt,
                            parent_presentation_id=parent_presentation_id
                        )
                        presentation.set_slides_data(presentation_data)
                        db.session.add(presentation)
                        db.session.commit()
                        
                        # Send the presentation ID
                        yield f"event: saved\n"
                        yield f"data: {json.dumps({'presentation_id': presentation.id})}\n\n"
                except Exception as e:
                    yield f"event: save_error\n"
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
        
        # Query all presentations for the user, ordered by most recent first
        presentations = Presentation.query.filter_by(user_id=current_user_id)\
            .order_by(Presentation.created_at.desc())\
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
        
        # Query the presentation and ensure it belongs to the current user
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
        
        # Query the presentation and ensure it belongs to the current user
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
