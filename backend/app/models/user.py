from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime
from . import db


class User(db.Model):
    __tablename__ = 'users'
    
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    name = db.Column(db.String(100), nullable=True)
    password_hash = db.Column(db.String(255), nullable=True)  # Nullable for OAuth users
    profile_picture = db.Column(db.Text, nullable=True)
    
    # OAuth fields
    oauth_provider = db.Column(db.String(50), nullable=True)
    oauth_id = db.Column(db.String(255), nullable=True)
    
    # Slide tokens - in-app currency (1 slide token = 1000 AI tokens)
    # New users start with 100 slide tokens
    # For existing databases, run: ALTER TABLE users ADD COLUMN slide_tokens FLOAT DEFAULT 100.0 NOT NULL;
    slide_tokens = db.Column(db.Float, default=100.0, nullable=False)
    
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
            'slide_tokens': self.slide_tokens,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
    
    def deduct_slide_tokens(self, tokens_used: int) -> float:
        """Deduct slide tokens based on AI token usage (1 slide token = 1000 AI tokens)"""
        slide_tokens_to_deduct = tokens_used / 1000.0
        self.slide_tokens = max(0, self.slide_tokens - slide_tokens_to_deduct)
        return slide_tokens_to_deduct
    
    def has_sufficient_tokens(self, estimated_tokens: int = 5000) -> bool:
        """Check if user has enough slide tokens for generation (default estimate: 5 slide tokens)"""
        estimated_slide_tokens = estimated_tokens / 1000.0
        return self.slide_tokens >= estimated_slide_tokens
    
    def __repr__(self):
        return f'<User {self.email}>'
