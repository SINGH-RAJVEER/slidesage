"""Presentation service for business logic"""
import logging
from typing import List, Generator, Dict
from app.repositories.presentation_repository import PresentationRepository
from app.repositories.user_repository import UserRepository
from app.models import Presentation
from app.services.ai_service import AIService


class PresentationService:
    def __init__(self):
        self.presentation_repo = PresentationRepository()
        self.user_repo = UserRepository()
        self.ai_service = AIService()

    def calculate_estimated_tokens(self, slide_count: int, detail_level: str, tonality: str) -> float:
        # Base token cost per slide (in slide tokens)
        base_token_per_slide = 1.0
        
        # Adjust based on detail level
        detail_multipliers = {
            'brief': 0.6,
            'concise': 0.8,
            'balanced': 1.0,
            'detailed': 2.0,
            'comprehensive': 3.0
        }
        base_token_per_slide = detail_multipliers.get(detail_level, 1.0)
        
        # Minor adjustment for tonality complexity
        tonality_multipliers = {
            'casual': 0.9,
            'professional': 1.0,
            'enthusiastic': 1.05,
            'persuasive': 1.1
        }
        tonality_multiplier = tonality_multipliers.get(tonality, 1.0)
        
        # Calculate total estimated tokens
        estimated_tokens = slide_count * base_token_per_slide * tonality_multiplier
        return round(estimated_tokens, 1)

    def generate_presentation_stream(
        self, 
        user_id: int, 
        topic: str, 
        slide_count: int,
        detail_level: str = 'balanced',
        tonality: str = 'professional'
    ) -> Generator[Dict, None, None]:
        """
        Generate presentation and stream slides
        
        Raises:
            ValueError: If user not found or insufficient tokens
        """
        # Verify user exists and has enough tokens
        user = self.user_repo.find_by_id(user_id)
        if not user:
            raise ValueError('User not found')
        
        estimated_tokens = self.calculate_estimated_tokens(slide_count, detail_level, tonality)
        
        # Check tokens only for non-unlimited users
        if not user.is_unlimited and user.slide_tokens < estimated_tokens:
            raise ValueError('Insufficient tokens')
        
        # Deduct tokens upfront (will be skipped for unlimited users in the model)
        self.user_repo.deduct_tokens(user, estimated_tokens)
        
        # Stream presentation generation
        yield from self.ai_service.generate_presentation_stream(
            topic, 
            slide_count, 
            detail_level, 
            tonality
        )

    def create_presentation(self, user_id: int, title: str, slides: dict, slide_count: int) -> Presentation:
        """
        Create a new presentation
        
        Raises:
            ValueError: If user not found
        """
        user = self.user_repo.find_by_id(user_id)
        if not user:
            raise ValueError('User not found')
        
        # Note: This service method needs to be updated to match new signature
        # For now, assuming slides is the slides_data dict and we need a prompt
        presentation = self.presentation_repo.create(user_id, title, prompt='', slides_data=slides)
        return presentation

    def get_user_presentations(self, user_id: int) -> List[Presentation]:
        """Get all presentations for a user"""
        return self.presentation_repo.find_by_user_id(user_id)

    def get_presentation(self, presentation_id: int, user_id: int) -> Presentation:
        """
        Get a specific presentation
        
        Raises:
            ValueError: If presentation not found or unauthorized
        """
        presentation = self.presentation_repo.find_by_id(presentation_id)
        
        if not presentation:
            raise ValueError('Presentation not found')
        
        if presentation.user_id != user_id:
            raise ValueError('Unauthorized access')
        
        return presentation

    def delete_presentation(self, presentation_id: int, user_id: int) -> None:
        """
        Delete a presentation
        
        Raises:
            ValueError: If presentation not found or unauthorized
        """
        presentation = self.presentation_repo.find_by_id(presentation_id)
        
        if not presentation:
            raise ValueError('Presentation not found')
        
        if presentation.user_id != user_id:
            raise ValueError('Unauthorized access')
        
        self.presentation_repo.delete(presentation)
