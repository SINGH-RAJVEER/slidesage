"""Integration tests for authentication endpoints"""
import pytest
import json
from unittest.mock import patch


@pytest.mark.integration
class TestAuthAPI:
    """Test authentication API endpoints"""
    
    def test_register_success(self, client):
        """Test successful user registration"""
        response = client.post('/api/auth/register', json={
            'email': 'newuser@example.com',
            'name': 'New User',
            'password': 'password123'
        })
        
        assert response.status_code == 201
        data = response.get_json()
        assert 'access_token' in data
        assert 'refresh_token' in data
        assert 'user' in data
        assert data['user']['email'] == 'newuser@example.com'
    
    def test_register_duplicate_email(self, client, sample_user):
        """Test registration with duplicate email"""
        response = client.post('/api/auth/register', json={
            'email': 'test@example.com',
            'name': 'Duplicate',
            'password': 'password'
        })
        
        assert response.status_code == 400
        data = response.get_json()
        assert 'error' in data
    
    def test_register_invalid_email(self, client):
        """Test registration with invalid email"""
        response = client.post('/api/auth/register', json={
            'email': 'invalid-email',
            'name': 'User',
            'password': 'password123'
        })
        
        assert response.status_code == 400
    
    def test_register_missing_fields(self, client):
        """Test registration with missing fields"""
        response = client.post('/api/auth/register', json={
            'email': 'test@example.com'
        })
        
        assert response.status_code == 400
    
    def test_login_success(self, client, sample_user):
        """Test successful login"""
        response = client.post('/api/auth/login', json={
            'email': 'test@example.com',
            'password': 'password123'
        })
        
        assert response.status_code == 200
        data = response.get_json()
        assert 'access_token' in data
        assert 'refresh_token' in data
        assert 'user' in data
    
    def test_login_wrong_password(self, client, sample_user):
        """Test login with wrong password"""
        response = client.post('/api/auth/login', json={
            'email': 'test@example.com',
            'password': 'wrongpassword'
        })
        
        assert response.status_code == 401
        data = response.get_json()
        assert 'error' in data
    
    def test_login_nonexistent_user(self, client):
        """Test login with non-existent user"""
        response = client.post('/api/auth/login', json={
            'email': 'nonexistent@example.com',
            'password': 'password'
        })
        
        assert response.status_code == 401
    
    @patch('app.services.auth_service.id_token')
    def test_google_login_success(self, mock_id_token, client):
        """Test Google OAuth login"""
        mock_id_token.verify_oauth2_token.return_value = {
            'sub': 'google123',
            'email': 'google@example.com',
            'name': 'Google User',
            'picture': 'https://example.com/photo.jpg'
        }
        
        response = client.post('/api/auth/google', json={
            'credential': 'fake-google-token'
        })
        
        assert response.status_code == 200
        data = response.get_json()
        assert 'access_token' in data
        assert 'user' in data
    
    @patch('app.services.auth_service.id_token')
    def test_google_login_invalid_token(self, mock_id_token, client):
        """Test Google OAuth with invalid token"""
        mock_id_token.verify_oauth2_token.side_effect = ValueError('Invalid token')
        
        response = client.post('/api/auth/google', json={
            'credential': 'invalid-token'
        })
        
        assert response.status_code == 400
    
    def test_get_current_user(self, client, auth_headers):
        """Test getting current user info"""
        response = client.get('/api/auth/me', headers=auth_headers)
        
        assert response.status_code == 200
        data = response.get_json()
        assert 'user' in data
        assert 'email' in data['user']
    
    def test_get_current_user_unauthorized(self, client):
        """Test getting current user without auth"""
        response = client.get('/api/auth/me')
        
        assert response.status_code == 401
    
    def test_update_profile(self, client, auth_headers):
        """Test updating user profile"""
        response = client.put('/api/auth/profile', 
            headers=auth_headers,
            json={
                'name': 'Updated Name'
            }
        )
        
        assert response.status_code == 200
        data = response.get_json()
        assert data['user']['name'] == 'Updated Name'
    
    def test_refresh_token(self, client, sample_user):
        """Test token refresh"""
        from flask_jwt_extended import create_refresh_token
        
        with client.application.app_context():
            refresh_token = create_refresh_token(identity=str(sample_user.id))
        
        response = client.post('/api/auth/refresh',
            headers={'Authorization': f'Bearer {refresh_token}'}
        )
        
        assert response.status_code == 200
        data = response.get_json()
        assert 'access_token' in data
