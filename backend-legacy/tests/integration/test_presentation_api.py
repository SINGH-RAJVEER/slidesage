"""Integration tests for presentation endpoints"""
import pytest
import json
from unittest.mock import patch, Mock


@pytest.mark.integration
class TestPresentationAPI:
    """Test presentation API endpoints"""
    
    def test_get_presentations_empty(self, client, auth_headers):
        """Test getting presentations when user has none"""
        response = client.get('/api/presentations', headers=auth_headers)
        
        assert response.status_code == 200
        data = response.get_json()
        assert 'presentations' in data
        assert isinstance(data['presentations'], list)
    
    def test_get_presentations_with_data(self, client, auth_headers, sample_presentation):
        """Test getting user's presentations"""
        response = client.get('/api/presentations', headers=auth_headers)
        
        assert response.status_code == 200
        data = response.get_json()
        assert len(data['presentations']) >= 1
        assert any(p['id'] == sample_presentation.id for p in data['presentations'])
    
    def test_get_presentations_unauthorized(self, client):
        """Test getting presentations without auth"""
        response = client.get('/api/presentations')
        
        assert response.status_code == 401
    
    def test_get_presentation_detail(self, client, auth_headers, sample_presentation):
        """Test getting specific presentation"""
        response = client.get(
            f'/api/presentations/{sample_presentation.id}',
            headers=auth_headers
        )
        
        assert response.status_code == 200
        data = response.get_json()
        assert 'presentation' in data
        assert data['presentation']['id'] == sample_presentation.id
        assert 'slides_data' in data['presentation']
    
    def test_get_presentation_not_found(self, client, auth_headers):
        """Test getting non-existent presentation"""
        response = client.get('/api/presentations/99999', headers=auth_headers)
        
        assert response.status_code == 404
    
    def test_get_presentation_unauthorized_user(self, client, db_session, sample_presentation):
        """Test getting another user's presentation"""
        from app.models.user import User
        from flask_jwt_extended import create_access_token
        
        # Create different user
        other_user = User(email='other@example.com', name='Other')
        other_user.set_password('pass')
        db_session.add(other_user)
        db_session.commit()
        
        with client.application.app_context():
            token = create_access_token(identity=str(other_user.id))
        
        response = client.get(
            f'/api/presentations/{sample_presentation.id}',
            headers={'Authorization': f'Bearer {token}'}
        )
        
        assert response.status_code == 403
    
    @patch('app.services.presentation_service.AIService')
    def test_generate_presentation_stream(self, mock_ai_service, client, auth_headers, sample_user):
        """Test presentation generation with streaming"""
        # Mock the AI service
        mock_stream = [
            {'type': 'created', 'data': {'presentation_id': 1}},
            {'type': 'slide', 'data': {'title': 'Slide 1', 'content': 'Content 1'}},
            {'type': 'complete', 'data': {'title': 'Test Presentation'}}
        ]
        
        response = client.post('/api/generate-presentation-stream',
            headers=auth_headers,
            json={
                'topic': 'Python Programming',
                'slide_count': 5,
                'detail_level': 'balanced',
                'tonality': 'professional'
            }
        )
        
        # For streaming endpoint, we check that it returns successfully
        # Full stream testing would require SSE client
        assert response.status_code in [200, 201]
    
    def test_generate_presentation_missing_fields(self, client, auth_headers):
        """Test generation with missing required fields"""
        response = client.post('/api/generate-presentation-stream',
            headers=auth_headers,
            json={
                'topic': 'Test'
                # Missing slide_count
            }
        )
        
        assert response.status_code == 400
    
    def test_generate_presentation_insufficient_tokens(self, client, auth_headers, sample_user, db_session):
        """Test generation with insufficient tokens"""
        # Set user tokens to 0
        sample_user.slide_tokens = 0
        db_session.commit()
        
        response = client.post('/api/generate-presentation-stream',
            headers=auth_headers,
            json={
                'topic': 'Test',
                'slide_count': 10,
                'detail_level': 'comprehensive'
            }
        )
        
        assert response.status_code == 402  # Payment Required
    
    def test_delete_presentation(self, client, auth_headers, sample_presentation):
        """Test deleting a presentation"""
        response = client.delete(
            f'/api/presentations/{sample_presentation.id}',
            headers=auth_headers
        )
        
        assert response.status_code == 200
        
        # Verify it's deleted
        get_response = client.get(
            f'/api/presentations/{sample_presentation.id}',
            headers=auth_headers
        )
        assert get_response.status_code == 404
    
    def test_delete_presentation_unauthorized(self, client, db_session, sample_presentation):
        """Test deleting another user's presentation"""
        from app.models.user import User
        from flask_jwt_extended import create_access_token
        
        # Create different user
        other_user = User(email='other@example.com', name='Other')
        other_user.set_password('pass')
        db_session.add(other_user)
        db_session.commit()
        
        with client.application.app_context():
            token = create_access_token(identity=str(other_user.id))
        
        response = client.delete(
            f'/api/presentations/{sample_presentation.id}',
            headers={'Authorization': f'Bearer {token}'}
        )
        
        assert response.status_code == 403
    
    def test_estimate_tokens(self, client, auth_headers):
        """Test token estimation endpoint"""
        response = client.post('/api/estimate-tokens',
            headers=auth_headers,
            json={
                'slide_count': 10,
                'detail_level': 'balanced',
                'tonality': 'professional'
            }
        )
        
        assert response.status_code == 200
        data = response.get_json()
        assert 'estimated_tokens' in data
        assert data['estimated_tokens'] > 0
