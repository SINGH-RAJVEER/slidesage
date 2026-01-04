"""
Management script for SlideSage admin operations.
Run with: python manage.py <command>

Security: This script requires the ADMIN_SECRET environment variable to be set
for sensitive operations. This prevents accidental or unauthorized modifications.
"""
import os
import sys
import hashlib

from app import create_app
from app.models import db, User


# Secret key required for admin operations
# Generate a secure secret: python -c "import secrets; print(secrets.token_hex(32))"
ADMIN_SECRET_HASH = os.getenv('ADMIN_SECRET_HASH')

# List of allowed dev emails that can be granted unlimited status
ALLOWED_DEV_EMAILS = [
    'user@mail.com',  # Your dev user
]


def verify_admin_secret(provided_secret: str) -> bool:
    """Verify the admin secret matches the stored hash"""
    if not ADMIN_SECRET_HASH:
        print("ERROR: ADMIN_SECRET_HASH environment variable not set.")
        print("Set it with: export ADMIN_SECRET_HASH=$(echo -n 'your-secret' | sha256sum | cut -d' ' -f1)")
        return False
    
    provided_hash = hashlib.sha256(provided_secret.encode()).hexdigest()
    return provided_hash == ADMIN_SECRET_HASH


def grant_unlimited_tokens(email: str, secret: str):
    """Grant unlimited tokens to a user (requires admin secret)"""
    if not verify_admin_secret(secret):
        print("ERROR: Invalid admin secret")
        return False
    
    if email not in ALLOWED_DEV_EMAILS:
        print(f"ERROR: Email '{email}' is not in the allowed dev emails list")
        print(f"Allowed emails: {ALLOWED_DEV_EMAILS}")
        return False
    
    app = create_app()
    with app.app_context():
        user = User.query.filter_by(email=email).first()
        if not user:
            print(f"ERROR: User with email '{email}' not found")
            return False
        
        user.is_unlimited = True
        db.session.commit()
        print(f"SUCCESS: Granted unlimited tokens to user '{email}'")
        return True


def revoke_unlimited_tokens(email: str, secret: str):
    """Revoke unlimited tokens from a user (requires admin secret)"""
    if not verify_admin_secret(secret):
        print("ERROR: Invalid admin secret")
        return False
    
    app = create_app()
    with app.app_context():
        user = User.query.filter_by(email=email).first()
        if not user:
            print(f"ERROR: User with email '{email}' not found")
            return False
        
        user.is_unlimited = False
        db.session.commit()
        print(f"SUCCESS: Revoked unlimited tokens from user '{email}'")
        return True


def list_unlimited_users():
    """List all users with unlimited tokens"""
    app = create_app()
    with app.app_context():
        users = User.query.filter_by(is_unlimited=True).all()
        if not users:
            print("No users with unlimited tokens found")
            return
        
        print("Users with unlimited tokens:")
        for user in users:
            print(f"  - {user.email} (ID: {user.id}, Name: {user.name})")


def init_dev_user(secret: str):
    """Initialize the dev user with unlimited tokens (run once during setup)"""
    if not verify_admin_secret(secret):
        print("ERROR: Invalid admin secret")
        return False
    
    app = create_app()
    with app.app_context():
        # Check if user exists
        user = User.query.filter_by(email='user@mail.com').first()
        
        if not user:
            print("Dev user not found. Creating...")
            user = User(
                email='user@mail.com',
                name='Dev User',
                is_unlimited=True
            )
            user.set_password('DevPassword123!')  # Change this!
            db.session.add(user)
            db.session.commit()
            print("SUCCESS: Created dev user with unlimited tokens")
            print("WARNING: Please change the default password!")
        else:
            user.is_unlimited = True
            db.session.commit()
            print(f"SUCCESS: Granted unlimited tokens to existing user '{user.email}'")
        
        return True


def migrate_add_unlimited_column():
    """Add the is_unlimited column if it doesn't exist"""
    app = create_app()
    with app.app_context():
        # Check if column exists
        from sqlalchemy import inspect, text
        inspector = inspect(db.engine)
        columns = [col['name'] for col in inspector.get_columns('users')]
        
        if 'is_unlimited' not in columns:
            print("Adding 'is_unlimited' column to users table...")
            with db.engine.connect() as conn:
                conn.execute(text('ALTER TABLE users ADD COLUMN is_unlimited BOOLEAN DEFAULT FALSE'))
                conn.commit()
            print("SUCCESS: Column added")
        else:
            print("Column 'is_unlimited' already exists")


def print_usage():
    """Print usage information"""
    print("""
SlideSage Management Script
===========================

Usage: python manage.py <command> [args]

Commands:
  grant <email> <secret>    Grant unlimited tokens to a user
  revoke <email> <secret>   Revoke unlimited tokens from a user
  list                      List all users with unlimited tokens
  init-dev <secret>         Initialize dev user with unlimited tokens
  migrate                   Add is_unlimited column (if missing)
  help                      Show this help message

Security Setup:
  1. Generate a secret: python -c "import secrets; print(secrets.token_hex(32))"
  2. Create hash: echo -n 'your-secret' | sha256sum | cut -d' ' -f1
  3. Set environment: export ADMIN_SECRET_HASH='the-hash-from-step-2'

Example:
  python manage.py grant user@mail.com your-secret
""")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print_usage()
        sys.exit(1)
    
    command = sys.argv[1].lower()
    
    if command == 'help':
        print_usage()
    
    elif command == 'grant':
        if len(sys.argv) != 4:
            print("Usage: python manage.py grant <email> <secret>")
            sys.exit(1)
        grant_unlimited_tokens(sys.argv[2], sys.argv[3])
    
    elif command == 'revoke':
        if len(sys.argv) != 4:
            print("Usage: python manage.py revoke <email> <secret>")
            sys.exit(1)
        revoke_unlimited_tokens(sys.argv[2], sys.argv[3])
    
    elif command == 'list':
        list_unlimited_users()
    
    elif command == 'init-dev':
        if len(sys.argv) != 3:
            print("Usage: python manage.py init-dev <secret>")
            sys.exit(1)
        init_dev_user(sys.argv[2])
    
    elif command == 'migrate':
        migrate_add_unlimited_column()
    
    else:
        print(f"Unknown command: {command}")
        print_usage()
        sys.exit(1)
