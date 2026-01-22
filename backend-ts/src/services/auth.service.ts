import { OAuth2Client } from "google-auth-library";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "../db/schema";
import { UserRepository } from "../repositories/user.repository";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET_KEY || "change-this-secret-key-in-production",
);

const ACCESS_TOKEN_EXPIRES = Number.parseInt(
  process.env.JWT_ACCESS_TOKEN_EXPIRES || "3600",
);
const REFRESH_TOKEN_EXPIRES = Number.parseInt(
  process.env.JWT_REFRESH_TOKEN_EXPIRES || "2592000",
);

export class AuthService {
  private userRepo: UserRepository;
  private googleClient: OAuth2Client;

  constructor() {
    this.userRepo = new UserRepository();
    this.googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }

  async registerUser(
    email: string,
    name: string,
    password: string,
  ): Promise<User> {
    email = email.trim().toLowerCase();
    name = name.trim();

    // Validate password strength
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumeric = /[0-9]/.test(password);

    if (!hasUppercase || !hasLowercase || !hasNumeric) {
      throw new Error(
        "Password must contain at least one uppercase letter, one lowercase letter, and one number",
      );
    }

    // Check if email already exists
    const existingUserByEmail = await this.userRepo.findByEmail(email);
    if (existingUserByEmail) {
      throw new Error("Email already registered");
    }

    // Check if name already exists
    const existingUserByName = await this.userRepo.findByName(name);
    if (existingUserByName) {
      throw new Error("Username already taken");
    }

    // Create user with hashed password
    const user = await this.userRepo.create(email, name, password);
    return user;
  }

  async loginUser(identifier: string, password: string): Promise<User | null> {
    identifier = identifier.trim();
    // Try to find user by email or name
    const normalizedIdentifier = identifier.toLowerCase();
    const user = await this.userRepo.findByEmailOrName(normalizedIdentifier);

    if (!user || !(await this.userRepo.verifyPassword(user, password))) {
      return null;
    }

    // Award daily login bonus
    await this.userRepo.awardDailyLoginBonus(user.id);

    return user;
  }

  async googleLogin(credential: string): Promise<User> {
    try {
      // Verify the Google token
      const ticket = await this.googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        throw new Error("Invalid Google token");
      }

      const googleId = payload.sub;
      const email = payload.email!.toLowerCase();
      const name = payload.name || email.split("@")[0];
      const profilePicture = payload.picture;

      // Check if user exists by Google ID
      let user = await this.userRepo.findByGoogleId(googleId);

      if (user) {
        // Update profile picture if changed
        if (profilePicture && user.profilePicture !== profilePicture) {
          await this.userRepo.update(user.id, { profilePicture });
        }

        // Award daily login bonus
        await this.userRepo.awardDailyLoginBonus(user.id);

        return user;
      }

      // Check if user exists by email
      user = await this.userRepo.findByEmail(email);

      if (user) {
        // Link Google account
        await this.userRepo.update(user.id, {
          oauthProvider: "google",
          oauthId: googleId,
          profilePicture,
        });

        // Award daily login bonus
        await this.userRepo.awardDailyLoginBonus(user.id);

        return user;
      }

      // Create new user
      user = await this.userRepo.createGoogleUser(
        email,
        name,
        googleId,
        profilePicture,
      );
      return user;
    } catch (error) {
      throw new Error(`Invalid Google token: ${error}`);
    }
  }

  async updateProfile(
    userId: number,
    options: {
      name?: string;
      email?: string;
      currentPassword?: string;
      newPassword?: string;
    },
  ): Promise<User> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const updates: Partial<User> = {};

    // Update name
    if (options.name) {
      updates.name = options.name.trim();
    }

    // Update email
    if (options.email) {
      const email = options.email.trim().toLowerCase();
      if (email !== user.email) {
        const existing = await this.userRepo.findByEmail(email);
        if (existing) {
          throw new Error("Email already in use");
        }
        updates.email = email;
      }
    }

    // Update password
    if (options.newPassword) {
      if (!options.currentPassword) {
        throw new Error("Current password required to set new password");
      }
      if (
        !(await this.userRepo.verifyPassword(user, options.currentPassword))
      ) {
        throw new Error("Current password is incorrect");
      }
      await this.userRepo.updatePassword(userId, options.newPassword);
    }

    // Apply updates
    if (Object.keys(updates).length > 0) {
      const updatedUser = await this.userRepo.update(userId, updates);
      return updatedUser!;
    }

    return user;
  }

  async getUserById(userId: number): Promise<User | undefined> {
    return await this.userRepo.findById(userId);
  }

  async createAccessToken(userId: number): Promise<string> {
    return await new SignJWT({ userId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_EXPIRES}s`)
      .sign(JWT_SECRET);
  }

  async createRefreshToken(userId: number): Promise<string> {
    return await new SignJWT({ userId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${REFRESH_TOKEN_EXPIRES}s`)
      .sign(JWT_SECRET);
  }

  async verifyToken(token: string): Promise<{ userId: number }> {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      return { userId: payload.userId as number };
    } catch (error) {
      throw new Error("Invalid token");
    }
  }

  userToDict(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      profile_picture: user.profilePicture,
      slide_tokens: user.isUnlimited
        ? Number.POSITIVE_INFINITY
        : user.slideTokens,
      is_unlimited: user.isUnlimited,
      created_at: user.createdAt.toISOString(),
    };
  }
}
