from datetime import datetime
import json
from . import db


class Presentation(db.Model):
    __tablename__ = 'presentations'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    title = db.Column(db.String(255), nullable=False)
    prompt = db.Column(db.Text, nullable=False)
    slides_data = db.Column(db.Text, nullable=False)
    parent_presentation_id = db.Column(db.Integer, db.ForeignKey('presentations.id'), nullable=True, index=True)  # For iterative editing
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship to parent presentation (self-referential)
    parent_presentation = db.relationship('Presentation', remote_side=[id], backref='iterations')
    
    def set_slides_data(self, data):
        """Store presentation data as JSON string"""
        self.slides_data = json.dumps(data)
    
    def get_slides_data(self):
        """Retrieve presentation data as Python dict"""
        try:
            return json.loads(self.slides_data)
        except (json.JSONDecodeError, TypeError):
            return {}
    
    def to_dict(self, include_slides=False):
        """Convert presentation to dictionary"""
        result = {
            'id': self.id,
            'user_id': self.user_id,
            'title': self.title,
            'prompt': self.prompt,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        
        if include_slides:
            result['slides_data'] = self.get_slides_data()
        
        return result
    
    def __repr__(self):
        return f'<Presentation {self.title} by User {self.user_id}>'
