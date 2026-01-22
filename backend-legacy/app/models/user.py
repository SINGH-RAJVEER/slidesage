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
    
    # New users start with 50 slide tokens (enough for ~20 slides with balanced detail)
    slide_tokens = db.Column(db.Float, default=50.0, nullable=False)
    
    # Flag for unlimited tokens (dev/admin users only)
    is_unlimited = db.Column(db.Boolean, default=False, nullable=False)
    
    # Last login date for daily bonus tracking
    last_login_date = db.Column(db.Date, nullable=True)
    
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
            'slide_tokens': float('inf') if self.is_unlimited else self.slide_tokens,
            'is_unlimited': self.is_unlimited,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
    
    def deduct_slide_tokens(self, tokens_used: int) -> float:
        """Deduct slide tokens based on AI token usage (1 slide token = 1000 AI tokens)"""
        # Skip deduction for unlimited users
        if self.is_unlimited:
            return 0.0
        slide_tokens_to_deduct = tokens_used / 1000.0
        self.slide_tokens = max(0, self.slide_tokens - slide_tokens_to_deduct)
        return slide_tokens_to_deduct
    
    def has_sufficient_tokens(self, estimated_tokens: int = 5000) -> bool:
        """Check if user has enough slide tokens for generation (default estimate: 5 slide tokens)"""
        # Unlimited users always have sufficient tokens
        if self.is_unlimited:
            return True
        estimated_slide_tokens = estimated_tokens / 1000.0
        return self.slide_tokens >= estimated_slide_tokens
    
    def award_daily_login_bonus(self) -> bool:
        from datetime import date
        today = date.today()
        
        # Check if user has already received bonus today
        if self.last_login_date == today:
            return False
        
        # Award 2 points daily bonus
        self.slide_tokens += 2.0
        self.last_login_date = today
        return True
    
    def __repr__(self):
        return f'<User {self.email}>'
