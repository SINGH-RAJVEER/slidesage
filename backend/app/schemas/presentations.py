"""Presentation-related schemas for request/response validation"""
from marshmallow import Schema, fields, validate, validates, ValidationError


class GeneratePresentationSchema(Schema):
    """Schema for presentation generation request"""
    topic = fields.Str(required=True, validate=validate.Length(min=1, max=500))
    slide_count = fields.Int(
        required=True,
        validate=validate.Range(min=1, max=50)
    )
    detail_level = fields.Str(
        validate=validate.OneOf(['brief', 'concise', 'balanced', 'detailed', 'comprehensive']),
        load_default='balanced'
    )
    tonality = fields.Str(
        validate=validate.OneOf(['professional', 'casual', 'enthusiastic', 'persuasive']),
        load_default='professional'
    )


class PresentationSchema(Schema):
    """Schema for presentation response"""
    id = fields.Int()
    user_id = fields.Int()
    title = fields.Str()
    prompt = fields.Str()
    slide_count = fields.Int()
    slides = fields.Raw()  # This will be populated from slides_data
    slides_data = fields.Raw()  # Raw JSON data
    created_at = fields.DateTime()
    updated_at = fields.DateTime()


class PresentationListSchema(Schema):
    """Schema for list of presentations"""
    id = fields.Int()
    title = fields.Str()
    slide_count = fields.Int()
    created_at = fields.DateTime()
    updated_at = fields.DateTime()
