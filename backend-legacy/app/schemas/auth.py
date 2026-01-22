"""Authentication-related schemas for request/response validation"""
from marshmallow import Schema, fields, validate, validates, ValidationError
import re


def validate_email_format(email: str) -> bool:
    """Validate email format"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return re.match(pattern, email) is not None


def validate_password_format(password: str) -> bool:
    """Validate password format: at least 8 characters, 1 uppercase, 1 number"""
    pattern = r'^(?=.*[A-Z])(?=.*\d).+$'
    return re.match(pattern, password) is not None and len(password) >= 8


class RegisterSchema(Schema):
    """Schema for user registration"""
    email = fields.Email(required=True)
    password = fields.Str(required=True, validate=validate.Length(min=8))
    name = fields.Str(required=True, validate=validate.Length(min=1))

    @validates('email')
    def validate_email(self, value, **kwargs):
        if not validate_email_format(value):
            raise ValidationError('Invalid email format')

    @validates('password')
    def validate_password(self, value, **kwargs):
        if not validate_password_format(value):
            raise ValidationError('Password must contain at least one uppercase letter and one number')


class LoginSchema(Schema):
    """Schema for user login"""
    email = fields.Email(required=True)
    password = fields.Str(required=True)


class GoogleAuthSchema(Schema):
    """Schema for Google OAuth authentication"""
    credential = fields.Str(required=True)


class UpdateProfileSchema(Schema):
    """Schema for updating user profile"""
    name = fields.Str(validate=validate.Length(min=1))
    email = fields.Email()
    current_password = fields.Str()
    new_password = fields.Str(validate=validate.Length(min=8))

    @validates('new_password')
    def validate_new_password(self, value, **kwargs):
        if value and not validate_password_format(value):
            raise ValidationError('Password must contain at least one uppercase letter and one number')


class UserSchema(Schema):
    """Schema for user response"""
    id = fields.Int()
    email = fields.Email()
    name = fields.Str()
    profile_picture_url = fields.Str(allow_none=True)
    slide_tokens = fields.Float()
    is_unlimited = fields.Bool()
    created_at = fields.DateTime()
    updated_at = fields.DateTime()
