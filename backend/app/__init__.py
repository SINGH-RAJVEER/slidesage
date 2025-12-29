from flask import Flask
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from app.config import Config
from app.models import db


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
    from app.routes import auth_bp, presentations_bp
    app.register_blueprint(auth_bp)
    app.register_blueprint(presentations_bp)
    
    # Initialize database
    with app.app_context():
        try:
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
            
            # Don't raise in development mode
            import sys
            if '--strict-db' in sys.argv:
                raise
    
    return app
