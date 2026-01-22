"""User repository for database access"""
from typing import Optional
from app.models import db, User


class UserRepository:
    """Repository for User model database operations"""

    @staticmethod
    def create(email: str, name: str, password_hash: str) -> User:
        """Create a new user"""
        user = User(email=email, name=name)
        user.set_password(password_hash)
        db.session.add(user)
        db.session.commit()
        return user

    @staticmethod
    def create_google_user(email: str, name: str, google_id: str, profile_picture_url: Optional[str] = None) -> User:
        """Create a new user from Google OAuth"""
        user = User(
            email=email,
            name=name,
            oauth_provider='google',
            oauth_id=google_id,
            profile_picture=profile_picture_url
        )
        db.session.add(user)
        db.session.commit()
        return user

    @staticmethod
    def find_by_email(email: str) -> Optional[User]:
        """Find user by email"""
        return User.query.filter_by(email=email).first()

    @staticmethod
    def find_by_id(user_id: int) -> Optional[User]:
        """Find user by ID"""
        return User.query.get(user_id)

    @staticmethod
    def find_by_google_id(google_id: str) -> Optional[User]:
        """Find user by Google ID (oauth_id)"""
        return User.query.filter_by(oauth_provider='google', oauth_id=google_id).first()

    @staticmethod
    def update(user: User, **kwargs) -> User:
        """Update user fields"""
        # Map google_id to oauth_id for backward compatibility
        if 'google_id' in kwargs:
            kwargs['oauth_id'] = kwargs.pop('google_id')
            if 'oauth_provider' not in kwargs:
                kwargs['oauth_provider'] = 'google'
        if 'profile_picture_url' in kwargs:
            kwargs['profile_picture'] = kwargs.pop('profile_picture_url')
        
        for key, value in kwargs.items():
            if hasattr(user, key):
                setattr(user, key, value)
        db.session.commit()
        return user

    @staticmethod
    def deduct_tokens(user: User, tokens: float) -> User:
        """Deduct tokens from user account"""
        # Skip deduction for unlimited users
        if user.is_unlimited:
            return user
        if user.slide_tokens < tokens:
            raise ValueError('Insufficient tokens')
        user.slide_tokens -= tokens
        db.session.commit()
        return user

    @staticmethod
    def add_tokens(user: User, tokens: float) -> User:
        """Add tokens to user account"""
        user.slide_tokens += tokens
        db.session.commit()
        return user
