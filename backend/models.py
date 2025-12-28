from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
import json

db = SQLAlchemy()

class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    name = db.Column(db.String(100), nullable=True)
    password_hash = db.Column(db.String(255), nullable=False)
    profile_picture = db.Column(db.String(500), nullable=True)  # URL or base64 string
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship to presentations
    presentations = db.relationship('Presentation', backref='user', lazy=True, cascade='all, delete-orphan')
    
    def set_password(self, password):
        """Hash and set the user's password"""
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        """Check if the provided password matches the hash"""
        return check_password_hash(self.password_hash, password)
    
    def to_dict(self):
        """Convert user to dictionary (excluding password)"""
        return {
            'id': self.id,
            'email': self.email,
            'name': self.name,
            'profile_picture': self.profile_picture,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
    
    def __repr__(self):
        return f'<User {self.email}>'


class Presentation(db.Model):
    __tablename__ = 'presentations'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    title = db.Column(db.String(255), nullable=False)
    prompt = db.Column(db.Text, nullable=False)
    slides_data = db.Column(db.Text, nullable=False)  # JSON string of the presentation structure
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
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

