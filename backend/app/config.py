import os
from dotenv import load_dotenv
from datetime import timedelta

load_dotenv()

class Config:
    LITELLM_MODEL = os.getenv('LITELLM_MODEL')
    LITELLM_PROXY_URL = os.getenv('LITELLM_PROXY_URL')
    
    DEBUG = os.getenv('FLASK_DEBUG', 'True').lower() == 'true'
    CORS_ORIGINS = os.getenv('CORS_ORIGINS')
    
    # JWT Configuration
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'change-this-secret-key-in-production')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=1)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)
    
    # Google OAuth Configuration
    GOOGLE_CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID')
    GOOGLE_CLIENT_SECRET = os.getenv('GOOGLE_CLIENT_SECRET')
    GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration"
    
    # Database Configuration
    default_db_url = 'postgresql://slidesage:slidesage@localhost:5432/slidesage'
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', default_db_url)
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,
        'pool_recycle': 300,
    }
