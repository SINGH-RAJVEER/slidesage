"""Pytest configuration and fixtures"""
import pytest
import os
from app import create_app
from app.models import db
from app.models.user import User
from app.models.presentation import Presentation
from app.config import Config


class TestConfig(Config):
    """Test configuration"""
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    JWT_SECRET_KEY = 'test-secret-key'
    GOOGLE_CLIENT_ID = 'test-google-client-id'
    GOOGLE_CLIENT_SECRET = 'test-google-client-secret'


@pytest.fixture(scope='function')
def app():
    """Create application for testing"""
    app = create_app(TestConfig)
    
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture(scope='function')
def client(app):
    """Create test client"""
    return app.test_client()


@pytest.fixture(scope='function')
def runner(app):
    """Create test CLI runner"""
    return app.test_cli_runner()


@pytest.fixture(scope='function')
def db_session(app):
    """Create database session for testing"""
    with app.app_context():
        yield db.session


@pytest.fixture
def sample_user(db_session):
    """Create a sample user for testing"""
    user = User(
        email='test@example.com',
        name='Test User',
        slide_tokens=50.0
    )
    user.set_password('password123')
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def sample_google_user(db_session):
    """Create a sample Google OAuth user for testing"""
    user = User(
        email='google@example.com',
        name='Google User',
        oauth_provider='google',
        oauth_id='google123',
        slide_tokens=50.0
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def unlimited_user(db_session):
    """Create a user with unlimited tokens"""
    user = User(
        email='admin@example.com',
        name='Admin User',
        is_unlimited=True,
        slide_tokens=50.0
    )
    user.set_password('adminpass')
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def sample_presentation(db_session, sample_user):
    """Create a sample presentation for testing"""
    presentation = Presentation(
        user_id=sample_user.id,
        title='Test Presentation',
        prompt='Create a presentation about Python',
        slides_data='{"slides": [], "theme": "default"}'
    )
    db_session.add(presentation)
    db_session.commit()
    return presentation


@pytest.fixture
def auth_headers(client, sample_user):
    """Get authentication headers for sample user"""
    from flask_jwt_extended import create_access_token
    
    with client.application.app_context():
        access_token = create_access_token(identity=str(sample_user.id))
    
    return {'Authorization': f'Bearer {access_token}'}
