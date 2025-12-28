import os
from dotenv import load_dotenv
from datetime import timedelta

load_dotenv()

class ConfigAI:
    LITELLM_MODEL = os.getenv('LITELLM_MODEL')
    LITELLM_PROXY_URL = os.getenv('LITELLM_PROXY_URL')
    
    DEBUG = os.getenv('FLASK_DEBUG', 'True').lower() == 'true'
    CORS_ORIGINS = os.getenv('CORS_ORIGINS')
    
    # JWT Configuration
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'change-this-secret-key-in-production')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=1)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)
    
    # Database Configuration
    # Default PostgreSQL connection string
    # For Docker Compose: postgresql://slidesage:slidesage@postgres:5432/slidesage
    # For local development: postgresql://slidesage:slidesage@localhost:5432/slidesage
    # Format: postgresql://user:password@host:port/dbname
    default_db_url = 'postgresql://slidesage:slidesage@localhost:5432/slidesage'
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', default_db_url)
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,  # Verify connections before using
        'pool_recycle': 300,    # Recycle connections after 5 minutes
    }
