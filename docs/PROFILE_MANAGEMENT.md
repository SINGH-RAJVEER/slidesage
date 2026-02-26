# User Profile Management

## Overview

Users can now manage their profile including editing their name, email, password, and profile picture. The profile page provides a secure interface for account management.

## Features

✅ **View Profile Information**

- Display user's name, email, and verification status
- Show account creation date and token balance

✅ **Edit Profile Details**

- Update full name
- Change email address
- Update profile picture via URL

✅ **Change Password**

- Secure password change with current password verification
- Minimum 8 character requirement
- Password confirmation field

## Backend Endpoints

### GET /api/profile

Retrieve current user's profile information.

**Headers:**

```
Authorization: Bearer <session_token>
```

**Response:**

```json
{
  "user": {
    "id": "user-id",
    "name": "John Doe",
    "email": "john@example.com",
    "image": "https://example.com/avatar.jpg",
    "emailVerified": true,
    "slideTokens": 50.0,
    "isUnlimited": false,
    "createdAt": "2026-02-26T00:00:00Z"
  }
}
```

### PUT /api/profile

Update user profile (name, email, or password).

**Request Body:**

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "currentPassword": "OldPassword123",
  "newPassword": "NewPassword123"
}
```

**Notes:**

- Fields are optional (at least one required)
- Email must be unique
- Password change requires current password verification
- New password must be at least 8 characters

**Response:**

```json
{
  "user": {
    "id": "user-id",
    "name": "Jane Doe",
    "email": "jane@example.com",
    "image": "https://example.com/avatar.jpg",
    "emailVerified": true
  }
}
```

### POST /api/profile/avatar

Update user's profile picture.

**Request Body:**

```json
{
  "imageUrl": "https://example.com/new-avatar.jpg"
}
```

**Response:**

```json
{
  "user": {
    "id": "user-id",
    "image": "https://example.com/new-avatar.jpg"
  }
}
```

## Frontend

### Profile Page Location

- **Route:** `/profile`
- **Access:** Authenticated users only
- **Navigation:** Profile button in header (next to Sign Out)

### Features on Profile Page

#### Profile Picture Section

- Display current avatar
- Input field for image URL
- Update button to save new image

#### Name Section

- Show current name
- Edit button to change
- Inline edit form with save/cancel

#### Email Section

- Display email and verification status
- Edit button to change email
- Verification status indicator

#### Password Section

- Change password option
- Form with:
  - Current password field
  - New password field (min 8 chars)
  - Confirm password field
- Validation for matching passwords

#### Account Information

- Display slide tokens balance
- Show account creation date
- Show if account has unlimited tokens

## Usage

### Accessing Profile

1. Click "Profile" button in header (requires login)
2. Or navigate directly to `/profile`

### Editing Name

1. Click "Edit" button next to name
2. Enter new name
3. Click "Save" to confirm or "Cancel" to discard

### Changing Email

1. Click "Edit" button next to email
2. Enter new email address
3. Click "Save" to confirm
4. System checks for duplicate emails

### Changing Password

1. Click "Change" button in Password section
2. Enter current password
3. Enter new password (min 8 characters)
4. Confirm new password
5. Click "Update Password" to save

### Updating Avatar

1. Copy image URL (from any image hosting service)
2. Paste URL in "Image URL" field
3. Click "Update Picture"
4. Avatar updates immediately on success

## Security Considerations

- ✅ All profile updates require authentication
- ✅ Passwords are hashed before storage
- ✅ Email uniqueness is validated
- ✅ Password changes require current password verification
- ✅ Session-based authentication using cookies

## Error Handling

Common errors and solutions:

| Error                                    | Cause                          | Solution                          |
| ---------------------------------------- | ------------------------------ | --------------------------------- |
| "Email already in use"                   | Email is already registered    | Use a different email address     |
| "Invalid image URL"                      | URL format is incorrect        | Use a valid image URL             |
| "Password must be at least 8 characters" | Password too short             | Use a password with 8+ characters |
| "Passwords do not match"                 | Confirm password doesn't match | Re-enter and confirm password     |
| "Unauthorized"                           | Not logged in                  | Sign in first                     |

## Testing

### Test Full Name Update

```bash
curl -X PUT http://localhost:8000/api/profile \
  -H "Content-Type: application/json" \
  -H "Cookie: better-auth.session_token=YOUR_SESSION" \
  -d '{"name": "New Name"}'
```

### Test Email Update

```bash
curl -X PUT http://localhost:8000/api/profile \
  -H "Content-Type: application/json" \
  -H "Cookie: better-auth.session_token=YOUR_SESSION" \
  -d '{"email": "newemail@example.com"}'
```

### Test Password Change

```bash
curl -X PUT http://localhost:8000/api/profile \
  -H "Content-Type: application/json" \
  -H "Cookie: better-auth.session_token=YOUR_SESSION" \
  -d '{
    "currentPassword": "OldPassword123",
    "newPassword": "NewPassword123"
  }'
```

### Test Avatar Update

```bash
curl -X POST http://localhost:8000/api/profile/avatar \
  -H "Content-Type: application/json" \
  -H "Cookie: better-auth.session_token=YOUR_SESSION" \
  -d '{"imageUrl": "https://example.com/avatar.jpg"}'
```

## Database Schema

Users table includes:

- `name` - User's full name
- `email` - User's email address
- `image` - URL to profile picture
- `emailVerified` - Boolean for email verification status
- `slideTokens` - Number of presentation generation tokens
- `isUnlimited` - Boolean for unlimited tokens
- `createdAt` - Account creation timestamp

## Future Enhancements

- Two-factor authentication (2FA)
- Email change verification
- Account deletion with data cleanup
- Profile visibility settings
- Account recovery options
- Login activity log
