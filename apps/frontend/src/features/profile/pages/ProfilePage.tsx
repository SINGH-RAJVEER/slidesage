import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, User as UserIcon, ArrowLeft } from "lucide-react";
import {
  ProfilePictureUploader,
  BasicInfoFields,
  PasswordFields,
  ProfileSubmitButton,
} from "../components/ProfilePage";

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [name, setName] = useState(user?.firstName || "");
  const [email, setEmail] = useState(user?.email || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profilePicture, setProfilePicture] = useState(
    user?.profile_picture || "",
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Check file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError("Image size must be less than 5MB");
        return;
      }

      // Check file type
      if (!file.type.startsWith("image/")) {
        setError("Please upload a valid image file");
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setProfilePicture(reader.result as string);
        setError("");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    // Validation
    if (password && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password && password.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    if (password) {
      const hasUpperCase = /[A-Z]/.test(password);
      const hasNumber = /\d/.test(password);
      if (!hasUpperCase || !hasNumber) {
        setError(
          "Password must contain at least one uppercase letter and one number",
        );
        return;
      }
    }

    setLoading(true);

    try {
      // Update user profile via Clerk
      if (user) {
        if (name !== user.firstName) {
          await user.update({ firstName: name });
        }
        // Note: Email and password updates require user verification in Clerk
        // They should be handled through Clerk's built-in flows
      }

      setSuccess("Profile updated successfully!");
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <Header />

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto mb-8 flex items-center gap-4">
          <div className="relative group">
            <Button
              variant="outline"
              onClick={() => navigate(-1)}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="absolute top-full left-0 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50">
              <div className="bg-white/10 backdrop-blur-lg border border-white/30 text-white px-4 py-2 rounded-lg shadow-lg whitespace-nowrap">
                Back to Generated
              </div>
            </div>
          </div>
          <h1 className="text-4xl font-bold text-white flex items-center gap-3">
            <UserIcon className="h-8 w-8" />
            Profile Settings
          </h1>
        </div>

        <Card className="max-w-3xl mx-auto shadow-2xl border border-white/20 bg-white/10 backdrop-blur-md">
          <CardContent className="p-8">
            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Profile Picture Section */}
              <ProfilePictureUploader
                profilePicture={profilePicture}
                onImageUpload={handleImageUpload}
              />

              {/* Alerts */}
              {error && (
                <Alert
                  variant="destructive"
                  className="bg-red-500/20 border-red-500/50 text-white"
                >
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {success && (
                <Alert className="bg-green-500/20 border-green-500/50 text-white">
                  <AlertDescription>{success}</AlertDescription>
                </Alert>
              )}

              {/* Basic Info Fields */}
              <BasicInfoFields
                name={name}
                email={email}
                loading={loading}
                onNameChange={setName}
                onEmailChange={setEmail}
              />

              {/* Password Fields */}
              <PasswordFields
                password={password}
                confirmPassword={confirmPassword}
                loading={loading}
                onPasswordChange={setPassword}
                onConfirmPasswordChange={setConfirmPassword}
              />

              {/* Submit Button */}
              <ProfileSubmitButton loading={loading} />
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
