from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager, jwt_required, get_jwt_identity
from config import ConfigAI
from models import db, User
from auth import auth_bp
from ai import AIService
import json

app = Flask(
    __name__,
    static_folder="public",
    static_url_path="/public"
)

# Load configuration
app.config.from_object(ConfigAI)

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

@app.route('/api/generate-presentation', methods=['POST'])
@jwt_required()
def generate_presentation():
    """Generate presentation - requires authentication"""
    try:
        # Get current user (optional, for logging/analytics)
        current_user_id = get_jwt_identity()
        
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be JSON'}), 400
            
        data = request.get_json()

        if not data:
            return jsonify({'error': 'Invalid JSON data'}), 400
            
        prompt = data.get('prompt')

        if not prompt:
            return jsonify({'error': 'Prompt is required'}), 400
       
        presentation_data = ai.generate_presentation_structure(prompt)
        
        return jsonify({
            'success': True,
            'data': presentation_data
        })
        
    except json.JSONDecodeError as e:
        return jsonify({
            'success': False,
            'error': f'Invalid JSON format: {str(e)}'
        }), 400

    except Exception as e:
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
