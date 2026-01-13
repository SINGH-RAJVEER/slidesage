"""Tests for Presentation model"""
import pytest
import json
from datetime import datetime
from app.models.presentation import Presentation


@pytest.mark.unit
class TestPresentationModel:
    """Test Presentation model"""
    
    def test_create_presentation(self, db_session, sample_user):
        """Test creating a presentation"""
        presentation = Presentation(
            user_id=sample_user.id,
            title='My Presentation',
            prompt='Create slides about AI',
            slides_data='{}'
        )
        
        db_session.add(presentation)
        db_session.commit()
        
        assert presentation.id is not None
        assert presentation.user_id == sample_user.id
        assert presentation.title == 'My Presentation'
        assert presentation.prompt == 'Create slides about AI'
        assert presentation.created_at is not None
        assert presentation.updated_at is not None
    
    def test_set_slides_data(self, sample_presentation):
        """Test setting slides data"""
        slides_dict = {
            'slides': [
                {'title': 'Slide 1', 'content': 'Content 1'},
                {'title': 'Slide 2', 'content': 'Content 2'}
            ],
            'theme': 'dark'
        }
        
        sample_presentation.set_slides_data(slides_dict)
        
        assert sample_presentation.slides_data is not None
        assert isinstance(sample_presentation.slides_data, str)
    
    def test_get_slides_data(self, sample_presentation):
        """Test getting slides data"""
        slides_dict = {
            'slides': [{'title': 'Slide 1'}],
            'theme': 'light'
        }
        
        sample_presentation.set_slides_data(slides_dict)
        retrieved_data = sample_presentation.get_slides_data()
        
        assert isinstance(retrieved_data, dict)
        assert retrieved_data == slides_dict
        assert len(retrieved_data['slides']) == 1
    
    def test_get_slides_data_invalid_json(self, db_session, sample_user):
        """Test handling invalid JSON in slides_data"""
        presentation = Presentation(
            user_id=sample_user.id,
            title='Test',
            prompt='Test',
            slides_data='invalid json{'
        )
        
        result = presentation.get_slides_data()
        assert result == {}
    
    def test_to_dict_without_slides(self, sample_presentation):
        """Test presentation serialization without slides"""
        pres_dict = sample_presentation.to_dict(include_slides=False)
        
        assert 'id' in pres_dict
        assert 'user_id' in pres_dict
        assert 'title' in pres_dict
        assert 'prompt' in pres_dict
        assert 'created_at' in pres_dict
        assert 'updated_at' in pres_dict
        assert 'slides_data' not in pres_dict
    
    def test_to_dict_with_slides(self, sample_presentation):
        """Test presentation serialization with slides"""
        slides_dict = {'slides': [{'title': 'Test'}], 'theme': 'default'}
        sample_presentation.set_slides_data(slides_dict)
        
        pres_dict = sample_presentation.to_dict(include_slides=True)
        
        assert 'slides_data' in pres_dict
        assert pres_dict['slides_data'] == slides_dict
    
    def test_parent_presentation_relationship(self, db_session, sample_user):
        """Test parent-child presentation relationship"""
        parent = Presentation(
            user_id=sample_user.id,
            title='Parent',
            prompt='Parent prompt',
            slides_data='{}'
        )
        db_session.add(parent)
        db_session.commit()
        
        child = Presentation(
            user_id=sample_user.id,
            title='Child',
            prompt='Child prompt',
            slides_data='{}',
            parent_presentation_id=parent.id
        )
        db_session.add(child)
        db_session.commit()
        
        assert child.parent_presentation_id == parent.id
        assert child.parent_presentation == parent
        assert len(parent.iterations) == 1
        assert parent.iterations[0] == child
    
    def test_repr(self, sample_presentation):
        """Test string representation"""
        repr_str = repr(sample_presentation)
        assert 'Test Presentation' in repr_str
        assert str(sample_presentation.user_id) in repr_str
