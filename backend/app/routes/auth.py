from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, create_refresh_token, jwt_required, get_jwt_identity
from app.models import db, User
from datetime import datetime
import re
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from app.config import Config

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')

def validate_email(email):
    """Basic email validation"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None

def validate_password(password):
    """Password validation - at least 8 characters"""
    return len(password) >= 8

@auth_bp.route('/register', methods=['POST'])
def register():
    """Register a new user"""
    try:
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be JSON'}), 400
        
        data = request.get_json()
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        name = data.get('name', '').strip()
        
        # Validation
        if not email:
            return jsonify({'error': 'Email is required'}), 400
        
        if not validate_email(email):
            return jsonify({'error': 'Invalid email format'}), 400
        
        if not password:
            return jsonify({'error': 'Password is required'}), 400
        
        if not validate_password(password):
            return jsonify({'error': 'Password must be at least 8 characters long'}), 400
        
        # Check if user already exists
        if User.query.filter_by(email=email).first():
            return jsonify({'error': 'Email already registered'}), 409
        
        # Create new user
        user = User(email=email, name=name)
        user.set_password(password)
        
        db.session.add(user)
        db.session.commit()
        
        # Generate tokens (identity must be a string)
        access_token = create_access_token(identity=str(user.id))
        refresh_token = create_refresh_token(identity=str(user.id))
        
        return jsonify({
            'success': True,
            'message': 'User registered successfully',
            'user': user.to_dict(),
            'access_token': access_token,
            'refresh_token': refresh_token
        }), 201
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@auth_bp.route('/login', methods=['POST'])
def login():
    """Login user and return JWT tokens"""
    try:
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be JSON'}), 400
        
        data = request.get_json()
        email = data.get('email', '').strip().lower()
        password = data.get('password', '')
        
        if not email or not password:
            return jsonify({'error': 'Email and password are required'}), 400
        
        # Find user
        user = User.query.filter_by(email=email).first()
        
        if not user or not user.check_password(password):
            return jsonify({'error': 'Invalid email or password'}), 401
        
        # Generate tokens (identity must be a string)
        access_token = create_access_token(identity=str(user.id))
        refresh_token = create_refresh_token(identity=str(user.id))
        
        return jsonify({
            'success': True,
            'message': 'Login successful',
            'user': user.to_dict(),
            'access_token': access_token,
            'refresh_token': refresh_token
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    """Refresh access token using refresh token"""
    try:
        current_user_id = get_jwt_identity()
        # Convert to int since identity is stored as string but user.id is int
        try:
            user_id = int(current_user_id) if isinstance(current_user_id, str) else current_user_id
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid token format'}), 422
        
        user = db.session.get(User, user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        # Generate new access token (identity must be a string)
        access_token = create_access_token(identity=str(user.id))
        
        return jsonify({
            'success': True,
            'access_token': access_token
        }), 200
        
    except Exception as e:
        print(f"Refresh token error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    """Get current authenticated user"""
    try:
        current_user_id = get_jwt_identity()
        # Convert to int since identity is stored as string but user.id is int
        try:
            user_id = int(current_user_id) if isinstance(current_user_id, str) else current_user_id
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid token format'}), 422
        
        user = db.session.get(User, user_id)
        
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        return jsonify({
            'success': True,
            'user': user.to_dict()
        }), 200
        
    except Exception as e:
        print(f"Get current user error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@auth_bp.route('/logout', methods=['POST'])
@jwt_required()
def logout():
    """Logout user (client should discard tokens)"""
    # In a production app, you might want to use a token blacklist
    # For now, we'll just return success and let the client discard tokens
    return jsonify({
        'success': True,
        'message': 'Logged out successfully'
    }), 200


@auth_bp.route('/profile', methods=['PUT'])
@jwt_required()
def update_profile():
    """Update user profile"""
    try:
        current_user_id = get_jwt_identity()
        # Convert to int since identity is stored as string but user.id is int
        try:
            user_id = int(current_user_id) if isinstance(current_user_id, str) else current_user_id
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid token format'}), 422
        
        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be JSON'}), 400
        
        data = request.get_json()
        
        # Update name if provided
        if 'name' in data:
            name = data.get('name', '').strip()
            user.name = name if name else None
        
        # Update email if provided and different
        if 'email' in data:
            email = data.get('email', '').strip().lower()
            if email and email != user.email:
                # Validate email format
                if not validate_email(email):
                    return jsonify({'error': 'Invalid email format'}), 400
                
                # Check if email is already taken
                existing_user = User.query.filter_by(email=email).first()
                if existing_user:
                    return jsonify({'error': 'Email already in use'}), 409
                
                user.email = email
        
        # Update password if provided
        if 'password' in data:
            password = data.get('password', '')
            if password:
                if not validate_password(password):
                    return jsonify({'error': 'Password must be at least 8 characters long'}), 400
                user.set_password(password)
        
        # Update profile picture if provided
        if 'profile_picture' in data:
            profile_picture = data.get('profile_picture', '').strip()
            user.profile_picture = profile_picture if profile_picture else None
        
        user.updated_at = datetime.utcnow()
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Profile updated successfully',
            'user': user.to_dict()
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@auth_bp.route('/slide-tokens', methods=['GET'])
@jwt_required()
def get_slide_tokens():
    """Get current user's slide token balance"""
    try:
        current_user_id = get_jwt_identity()
        try:
            user_id = int(current_user_id) if isinstance(current_user_id, str) else current_user_id
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid token format'}), 422
        
        user = db.session.get(User, user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404
        
        return jsonify({
            'success': True,
            'slide_tokens': user.slide_tokens
        }), 200
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@auth_bp.route('/google', methods=['POST'])
def google_login():
    """Authenticate user with Google OAuth token"""
    try:
        if not request.is_json:
            return jsonify({'error': 'Content-Type must be JSON'}), 400
        
        data = request.get_json()
        token = data.get('token')
        
        if not token:
            return jsonify({'error': 'Google token is required'}), 400
        
        # Verify the Google token
        try:
            idinfo = id_token.verify_oauth2_token(
                token, 
                google_requests.Request(), 
                Config.GOOGLE_CLIENT_ID
            )
            
            # Verify the token is for our app
            if idinfo['iss'] not in ['accounts.google.com', 'https://accounts.google.com']:
                return jsonify({'error': 'Invalid token issuer'}), 401
            
            # Extract user information
            google_id = idinfo['sub']
            email = idinfo.get('email', '').lower()
            name = idinfo.get('name', '')
            picture = idinfo.get('picture', '')
            email_verified = idinfo.get('email_verified', False)
            
            if not email_verified:
                return jsonify({'error': 'Email not verified with Google'}), 401
            
        except ValueError as e:
            # Invalid token
            return jsonify({'error': f'Invalid Google token: {str(e)}'}), 401
        
        # Check if user exists with this Google ID
        user = User.query.filter_by(oauth_provider='google', oauth_id=google_id).first()
        
        if not user:
            # Check if user exists with this email (from traditional signup)
            user = User.query.filter_by(email=email).first()
            
            if user:
                # Link Google account to existing user
                user.oauth_provider = 'google'
                user.oauth_id = google_id
                if not user.profile_picture and picture:
                    user.profile_picture = picture
                user.updated_at = datetime.utcnow()
            else:
                # Create new user
                user = User(
                    email=email,
                    name=name,
                    profile_picture=picture,
                    oauth_provider='google',
                    oauth_id=google_id
                )
                db.session.add(user)
            
            db.session.commit()
        
        # Generate JWT tokens
        access_token = create_access_token(identity=str(user.id))
        refresh_token = create_refresh_token(identity=str(user.id))
        
        return jsonify({
            'success': True,
            'message': 'Google login successful',
            'user': user.to_dict(),
            'access_token': access_token,
            'refresh_token': refresh_token
        }), 200
        
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
