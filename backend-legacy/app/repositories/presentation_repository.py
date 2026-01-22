"""Presentation repository for database access"""
from typing import List, Optional
from app.models import db, Presentation


class PresentationRepository:
    """Repository for Presentation model database operations"""

    @staticmethod
    def create(user_id: int, title: str, prompt: str, slides_data: dict) -> Presentation:
        """Create a new presentation"""
        presentation = Presentation(
            user_id=user_id,
            title=title,
            prompt=prompt
        )
        presentation.set_slides_data(slides_data)
        db.session.add(presentation)
        db.session.commit()
        return presentation

    @staticmethod
    def find_by_id(presentation_id: int) -> Optional[Presentation]:
        """Find presentation by ID"""
        return Presentation.query.get(presentation_id)

    @staticmethod
    def find_by_user_id(user_id: int) -> List[Presentation]:
        """Find all presentations for a user"""
        return Presentation.query.filter_by(user_id=user_id).order_by(Presentation.created_at.desc()).all()

    @staticmethod
    def delete(presentation: Presentation) -> None:
        """Delete a presentation"""
        db.session.delete(presentation)
        db.session.commit()

    @staticmethod
    def update(presentation: Presentation, **kwargs) -> Presentation:
        """Update presentation fields"""
        for key, value in kwargs.items():
            if hasattr(presentation, key):
                setattr(presentation, key, value)
        db.session.commit()
        return presentation
