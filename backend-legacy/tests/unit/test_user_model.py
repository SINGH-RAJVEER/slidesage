"""Tests for User model"""
import pytest
from datetime import datetime, date
from app.models.user import User


@pytest.mark.unit
class TestUserModel:
    """Test User model"""
    
    def test_create_user(self, db_session):
        """Test creating a user"""
        user = User(
            email='new@example.com',
            name='New User',
            slide_tokens=50.0
        )
        user.set_password('testpass')
        
        db_session.add(user)
        db_session.commit()
        
        assert user.id is not None
        assert user.email == 'new@example.com'
        assert user.name == 'New User'
        assert user.slide_tokens == 50.0
        assert user.is_unlimited is False
        assert user.password_hash is not None
    
    def test_set_password(self, db_session):
        """Test password hashing"""
        user = User(email='test@example.com', name='Test')
        user.set_password('mypassword')
        
        assert user.password_hash is not None
        assert user.password_hash != 'mypassword'
    
    def test_check_password(self, sample_user):
        """Test password verification"""
        assert sample_user.check_password('password123') is True
        assert sample_user.check_password('wrongpassword') is False
    
    def test_to_dict(self, sample_user):
        """Test user serialization"""
        user_dict = sample_user.to_dict()
        
        assert 'id' in user_dict
        assert 'email' in user_dict
        assert 'name' in user_dict
        assert 'slide_tokens' in user_dict
        assert 'password_hash' not in user_dict
        assert user_dict['email'] == 'test@example.com'
        assert user_dict['name'] == 'Test User'
    
    def test_unlimited_user_tokens(self, unlimited_user):
        """Test unlimited user shows infinity tokens"""
        user_dict = unlimited_user.to_dict()
        
        assert user_dict['is_unlimited'] is True
        assert user_dict['slide_tokens'] == float('inf')
    
    def test_google_oauth_user(self, sample_google_user):
        """Test Google OAuth user"""
        assert sample_google_user.oauth_provider == 'google'
        assert sample_google_user.oauth_id == 'google123'
        assert sample_google_user.password_hash is None
    
    def test_user_presentations_relationship(self, db_session, sample_user):
        """Test user-presentations relationship"""
        from app.models.presentation import Presentation
        
        presentation = Presentation(
            user_id=sample_user.id,
            title='Test',
            prompt='Test prompt',
            slides_data='{}'
        )
        db_session.add(presentation)
        db_session.commit()
        
        assert len(sample_user.presentations) == 1
        assert sample_user.presentations[0].title == 'Test'
    
    def test_unique_email_constraint(self, db_session, sample_user):
        """Test email uniqueness constraint"""
        duplicate_user = User(
            email='test@example.com',  # Same as sample_user
            name='Duplicate',
            slide_tokens=50.0
        )
        
        db_session.add(duplicate_user)
        
        with pytest.raises(Exception):  # SQLAlchemy IntegrityError
            db_session.commit()
