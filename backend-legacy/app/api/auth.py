"""Authentication API endpoints"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import (
    create_access_token, 
    create_refresh_token, 
    jwt_required, 
    get_jwt_identity
)
from marshmallow import ValidationError
from app.schemas.auth import (
    RegisterSchema, 
    LoginSchema, 
    GoogleAuthSchema, 
    UpdateProfileSchema,
    UserSchema
)
from app.services.auth_service import AuthService


auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')
auth_service = AuthService()


def _get_current_user_id() -> int:
    """Helper to get and convert current user ID from JWT"""
    current_user_id = get_jwt_identity()
    try:
        return int(current_user_id) if isinstance(current_user_id, str) else current_user_id
    except (ValueError, TypeError):
        raise ValueError('Invalid token format')


@auth_bp.errorhandler(ValidationError)
def handle_validation_error(e):
    """Handle marshmallow validation errors"""
    return jsonify({'error': {'message': 'Validation failed', 'details': e.messages}}), 400


@auth_bp.errorhandler(ValueError)
def handle_value_error(e):
    """Handle service layer value errors"""
    return jsonify({'error': {'message': str(e)}}), 400


@auth_bp.route('/register', methods=['POST'])
def register():
    """Register a new user"""
    try:
        # Validate and deserialize input
        schema = RegisterSchema()
        data = schema.load(request.get_json())
        
        # Call service
        user = auth_service.register_user(
            email=data['email'],
            name=data['name'],
            password=data['password']
        )
        
        # Generate tokens
        access_token = create_access_token(identity=str(user.id))
        refresh_token = create_refresh_token(identity=str(user.id))
        
        # Serialize response
        user_schema = UserSchema()
        return jsonify({
            'user': user_schema.dump(user),
            'access_token': access_token,
            'refresh_token': refresh_token
        }), 201
        
    except ValueError as e:
        if 'already registered' in str(e):
            return jsonify({'error': {'message': str(e)}}), 409
        raise


@auth_bp.route('/login', methods=['POST'])
def login():
    """Login user and return JWT tokens"""
    # Validate and deserialize input
    schema = LoginSchema()
    data = schema.load(request.get_json())
    
    # Call service
    user = auth_service.login_user(
        email=data['email'],
        password=data['password']
    )
    
    if not user:
        return jsonify({'error': {'message': 'Invalid email or password'}}), 401
    
    # Generate tokens
    access_token = create_access_token(identity=str(user.id))
    refresh_token = create_refresh_token(identity=str(user.id))
    
    # Serialize response
    user_schema = UserSchema()
    return jsonify({
        'user': user_schema.dump(user),
        'access_token': access_token,
        'refresh_token': refresh_token
    }), 200


@auth_bp.route('/google', methods=['POST'])
def google_login():
    """Authenticate user with Google OAuth"""
    try:
        # Validate and deserialize input
        schema = GoogleAuthSchema()
        data = schema.load(request.get_json())
        
        # Call service
        user = auth_service.google_login(credential=data['credential'])
        
        # Generate tokens
        access_token = create_access_token(identity=str(user.id))
        refresh_token = create_refresh_token(identity=str(user.id))
        
        # Serialize response
        user_schema = UserSchema()
        return jsonify({
            'user': user_schema.dump(user),
            'access_token': access_token,
            'refresh_token': refresh_token
        }), 200
        
    except ValueError as e:
        return jsonify({'error': {'message': str(e)}}), 401


@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    """Refresh access token using refresh token"""
    user_id = _get_current_user_id()
    
    user = auth_service.get_user_by_id(user_id)
    if not user:
        return jsonify({'error': {'message': 'User not found'}}), 404
    
    # Generate new access token
    access_token = create_access_token(identity=str(user.id))
    
    return jsonify({'access_token': access_token}), 200


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_current_user():
    """Get current authenticated user"""
    user_id = _get_current_user_id()
    
    user = auth_service.get_user_by_id(user_id)
    if not user:
        return jsonify({'error': {'message': 'User not found'}}), 404
    
    user_schema = UserSchema()
    return jsonify({'user': user_schema.dump(user)}), 200


@auth_bp.route('/profile', methods=['PUT'])
@jwt_required()
def update_profile():
    """Update user profile"""
    user_id = _get_current_user_id()
    
    # Validate and deserialize input
    schema = UpdateProfileSchema()
    data = schema.load(request.get_json())
    
    # Call service
    user = auth_service.update_profile(
        user_id=user_id,
        name=data.get('name'),
        email=data.get('email'),
        current_password=data.get('current_password'),
        new_password=data.get('new_password')
    )
    
    # Serialize response
    user_schema = UserSchema()
    return jsonify({'user': user_schema.dump(user)}), 200


@auth_bp.route('/logout', methods=['POST'])
@jwt_required()
def logout():
    """Logout user (client should discard tokens)"""
    # In production, implement token blacklist if needed
    return jsonify({'message': 'Logged out successfully'}), 200
