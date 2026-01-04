"""Authentication service for business logic"""
from typing import Optional, Dict
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from app.repositories.user_repository import UserRepository
from app.models import User
from app.config import Config


class AuthService:
    """Service for authentication business logic"""

    def __init__(self):
        self.user_repo = UserRepository()

    def register_user(self, email: str, name: str, password: str) -> User:
        """
        Register a new user
        
        Raises:
            ValueError: If email already exists
        """
        email = email.strip().lower()
        name = name.strip()
        
        # Check if user already exists
        if self.user_repo.find_by_email(email):
            raise ValueError('Email already registered')
        
        # Create user with hashed password
        user = self.user_repo.create(email, name, password)
        return user

    def login_user(self, email: str, password: str) -> Optional[User]:
        """
        Authenticate user with email and password
        
        Returns:
            User if credentials are valid, None otherwise
        """
        email = email.strip().lower()
        user = self.user_repo.find_by_email(email)
        
        if not user or not user.check_password(password):
            return None
        
        return user

    def google_login(self, credential: str) -> User:
        """
        Authenticate or register user via Google OAuth
        
        Raises:
            ValueError: If token is invalid
        """
        try:
            # Verify the Google token
            idinfo = id_token.verify_oauth2_token(
                credential, 
                google_requests.Request(), 
                Config.GOOGLE_CLIENT_ID
            )
            
            google_id = idinfo['sub']
            email = idinfo['email'].lower()
            name = idinfo.get('name', email.split('@')[0])
            profile_picture = idinfo.get('picture')
            
            # Check if user exists by Google ID
            user = self.user_repo.find_by_google_id(google_id)
            
            if user:
                # Update profile picture if changed
                if profile_picture and user.profile_picture_url != profile_picture:
                    self.user_repo.update(user, profile_picture_url=profile_picture)
                return user
            
            # Check if user exists by email
            user = self.user_repo.find_by_email(email)
            
            if user:
                # Link Google account
                self.user_repo.update(
                    user, 
                    google_id=google_id,
                    profile_picture_url=profile_picture
                )
                return user
            
            # Create new user
            user = self.user_repo.create_google_user(
                email, 
                name, 
                google_id, 
                profile_picture
            )
            return user
            
        except ValueError as e:
            raise ValueError(f'Invalid Google token: {str(e)}')

    def update_profile(self, user_id: int, name: Optional[str] = None, 
                      email: Optional[str] = None, 
                      current_password: Optional[str] = None,
                      new_password: Optional[str] = None) -> User:
        """
        Update user profile
        
        Raises:
            ValueError: If user not found or validation fails
        """
        user = self.user_repo.find_by_id(user_id)
        if not user:
            raise ValueError('User not found')
        
        updates = {}
        
        # Update name
        if name:
            updates['name'] = name.strip()
        
        # Update email
        if email:
            email = email.strip().lower()
            if email != user.email:
                existing = self.user_repo.find_by_email(email)
                if existing:
                    raise ValueError('Email already in use')
                updates['email'] = email
        
        # Update password
        if new_password:
            if not current_password:
                raise ValueError('Current password required to set new password')
            if not user.check_password(current_password):
                raise ValueError('Current password is incorrect')
            user.set_password(new_password)
        
        # Apply updates
        if updates:
            user = self.user_repo.update(user, **updates)
        
        return user

    def get_user_by_id(self, user_id: int) -> Optional[User]:
        """Get user by ID"""
        return self.user_repo.find_by_id(user_id)
