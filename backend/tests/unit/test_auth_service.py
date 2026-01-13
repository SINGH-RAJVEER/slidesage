"""Tests for AuthService"""
import pytest
from unittest.mock import Mock, patch, MagicMock
from app.services.auth_service import AuthService
from app.models.user import User


@pytest.mark.unit
class TestAuthService:
    """Test AuthService business logic"""
    
    @pytest.fixture
    def auth_service(self):
        """Create auth service instance"""
        return AuthService()
    
    def test_register_user_success(self, auth_service, db_session):
        """Test successful user registration"""
        user = auth_service.register_user(
            email='newuser@example.com',
            name='New User',
            password='password123'
        )
        
        assert user is not None
        assert user.email == 'newuser@example.com'
        assert user.name == 'New User'
        assert user.check_password('password123')
        assert user.slide_tokens == 50.0
    
    def test_register_user_duplicate_email(self, auth_service, sample_user):
        """Test registration with existing email"""
        with pytest.raises(ValueError, match='Email already registered'):
            auth_service.register_user(
                email='test@example.com',  # Same as sample_user
                name='Duplicate',
                password='password'
            )
    
    def test_register_user_email_normalization(self, auth_service, db_session):
        """Test email normalization (lowercase, stripped)"""
        user = auth_service.register_user(
            email='  NewUser@Example.COM  ',
            name='New User',
            password='password'
        )
        
        assert user.email == 'newuser@example.com'
    
    def test_login_user_success(self, auth_service, sample_user):
        """Test successful login"""
        user = auth_service.login_user('test@example.com', 'password123')
        
        assert user is not None
        assert user.id == sample_user.id
        assert user.email == sample_user.email
    
    def test_login_user_wrong_password(self, auth_service, sample_user):
        """Test login with wrong password"""
        user = auth_service.login_user('test@example.com', 'wrongpassword')
        
        assert user is None
    
    def test_login_user_nonexistent_email(self, auth_service, app):
        """Test login with non-existent email"""
        with app.app_context():
            user = auth_service.login_user('nonexistent@example.com', 'password')
            
            assert user is None
    
    def test_login_user_email_normalization(self, auth_service, sample_user):
        """Test login with non-normalized email"""
        user = auth_service.login_user('  TEST@Example.COM  ', 'password123')
        
        assert user is not None
        assert user.id == sample_user.id
    
    @patch('app.services.auth_service.id_token')
    def test_google_login_new_user(self, mock_id_token, auth_service, db_session):
        """Test Google login for new user"""
        # Mock Google token verification
        mock_id_token.verify_oauth2_token.return_value = {
            'sub': 'google123',
            'email': 'newgoogle@example.com',
            'name': 'Google User',
            'picture': 'https://example.com/photo.jpg'
        }
        
        user = auth_service.google_login('fake-credential')
        
        assert user is not None
        assert user.email == 'newgoogle@example.com'
        assert user.name == 'Google User'
        assert user.oauth_provider == 'google'
        assert user.oauth_id == 'google123'
        assert user.profile_picture == 'https://example.com/photo.jpg'
    
    @patch('app.services.auth_service.id_token')
    def test_google_login_existing_google_user(self, mock_id_token, auth_service, sample_google_user):
        """Test Google login for existing Google user"""
        mock_id_token.verify_oauth2_token.return_value = {
            'sub': 'google123',
            'email': 'google@example.com',
            'name': 'Google User',
            'picture': 'https://example.com/new-photo.jpg'
        }
        
        user = auth_service.google_login('fake-credential')
        
        assert user.id == sample_google_user.id
        assert user.email == sample_google_user.email
    
    @patch('app.services.auth_service.id_token')
    def test_google_login_existing_email_user(self, mock_id_token, auth_service, sample_user, db_session):
        """Test Google login linking existing email user"""
        mock_id_token.verify_oauth2_token.return_value = {
            'sub': 'google456',
            'email': 'test@example.com',  # Same as sample_user
            'name': 'Test User',
            'picture': 'https://example.com/photo.jpg'
        }
        
        user = auth_service.google_login('fake-credential')
        
        assert user.id == sample_user.id
        assert user.oauth_id == 'google456'
        assert user.oauth_provider == 'google'
    
    @patch('app.services.auth_service.id_token')
    def test_google_login_invalid_token(self, mock_id_token, auth_service):
        """Test Google login with invalid token"""
        mock_id_token.verify_oauth2_token.side_effect = ValueError('Invalid token')
        
        with pytest.raises(ValueError, match='Invalid Google token'):
            auth_service.google_login('invalid-credential')
