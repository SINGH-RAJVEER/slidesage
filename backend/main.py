from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
from flask_jwt_extended import JWTManager, jwt_required, get_jwt_identity, verify_jwt_in_request
from config import Config
from models import db, User, Presentation
from auth import auth_bp
from ai import AIService
import json

app = Flask(
    __name__,
    static_folder="public",
    static_url_path="/public"
)

# Load configuration
app.config.from_object(Config)

# Initialize extensions
CORS(app)
jwt = JWTManager(app)
db.init_app(app)

# Register blueprints
app.register_blueprint(auth_bp)

# Initialize database (lazy - only when app starts)
def init_db():
    """Initialize database tables"""
    try:
        with app.app_context():
            db.create_all()
            print("✓ Database initialized successfully")
    except Exception as e:
        error_msg = str(e)
        db_url = app.config.get('SQLALCHEMY_DATABASE_URI', 'Not set')
        
        print("\n" + "="*60)
        print("✗ Database connection failed!")
        print("="*60)
        print(f"\nError: {error_msg}")
        print(f"\nConnection string: {db_url}")
        print("\nTo fix this, start PostgreSQL:")
        print("\n  Option 1 - Docker Compose (recommended):")
        print("    cd /home/rajveer/Code/projects/SlideSage")
        print("    docker compose up -d postgres")
        print("\n  Option 2 - Local PostgreSQL:")
        print("    # Install PostgreSQL first if needed")
        print("    # Then create database:")
        print("    #   createdb slidesage")
        print("    #   createuser slidesage")
        print("\n  Option 3 - Check if PostgreSQL is running:")
        print("    # Linux: sudo systemctl status postgresql")
        print("    # macOS: brew services list")
        print("="*60 + "\n")
        
        # Don't raise - allow app to start but auth won't work
        # This is better for development
        import sys
        if '--strict-db' in sys.argv:
            raise

# Initialize database on startup (with graceful failure)
try:
    init_db()
except Exception:
    # Already printed error message above
    pass

ai = AIService()

@app.route('/api/generate-presentation-stream', methods=['POST'])
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
            
            for event in ai.generate_presentation_stream(prompt, slide_count, detail_level, tonality):
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
                    with app.app_context():
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


@app.route('/api/iterate-presentation-stream', methods=['POST'])
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
            
            for event in ai.iterate_presentation_stream(prompt, parent_data, slide_count, detail_level, tonality):
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
                    with app.app_context():
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


@app.route('/api/presentations', methods=['GET'])
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

@app.route('/api/presentations/<int:presentation_id>', methods=['GET'])
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

@app.route('/api/presentations/<int:presentation_id>', methods=['DELETE'])
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

@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint (no auth required)"""
    return jsonify({
        'status': 'healthy',
        'message': 'SlideSage API is running'
    }), 200

if __name__ == '__main__':
    app.run(debug=True)
