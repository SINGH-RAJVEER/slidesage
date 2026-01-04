from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from app.config import Config
from app.models import db


def register_blueprints(app):
    """Register all application blueprints"""
    from app.api.auth import auth_bp
    from app.api.presentations import presentations_bp
    
    app.register_blueprint(auth_bp)
    app.register_blueprint(presentations_bp)


def register_error_handlers(app):
    """Register global error handlers"""
    
    @app.errorhandler(404)
    def not_found(e):
        return jsonify({'error': {'message': 'Resource not found'}}), 404
    
    @app.errorhandler(500)
    def internal_error(e):
        return jsonify({'error': {'message': 'Internal server error'}}), 500


def create_app(config_class=Config):
    """Application factory pattern"""
    app = Flask(
        __name__,
        static_folder="../public",
        static_url_path="/public"
    )
    
    # Load configuration
    app.config.from_object(config_class)
    
    # Initialize extensions
    CORS(app)
    jwt = JWTManager(app)
    db.init_app(app)
    
    # Register blueprints
    register_blueprints(app)
    
    # Register error handlers
    register_error_handlers(app)
    
    # Initialize database
    with app.app_context():
        try:
            db.create_all()
            print("Database initialized successfully")
        except Exception as e:
            error_msg = str(e)
            db_url = app.config.get('SQLALCHEMY_DATABASE_URI', 'Not set')
            
            print("\n" + "="*60)
            print("✗ Database connection failed!")
            print("="*60)
            print(f"\nError: {error_msg}")
            print(f"\nConnection string: {db_url}")
            
            # Don't raise in development mode
            import sys
            if '--strict-db' in sys.argv:
                raise
    
    return app
