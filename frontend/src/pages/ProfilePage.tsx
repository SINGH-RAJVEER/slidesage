import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { authService } from "@/services/authService";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Camera, User as UserIcon, ArrowLeft } from "lucide-react";

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profilePicture, setProfilePicture] = useState(
    user?.profile_picture || ""
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    setLoading(true);

    try {
      const updateData: any = {};

      if (name !== user?.name) updateData.name = name;
      if (email !== user?.email) updateData.email = email;
      if (password) updateData.password = password;
      if (profilePicture !== user?.profile_picture)
        updateData.profile_picture = profilePicture;

      const result = await authService.updateProfile(updateData);

      if (result.success) {
        setSuccess("Profile updated successfully!");
        setPassword("");
        setConfirmPassword("");
        await refreshUser();
      } else {
        setError(result.error || "Failed to update profile");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
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
          <Button
            variant="outline"
            onClick={() => navigate(-1)}
            className="bg-white/10 border-white/20 text-white hover:bg-white/20 transition-all duration-200"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <h1 className="text-4xl font-bold text-white flex items-center gap-3">
            <UserIcon className="h-8 w-8" />
            Profile Settings
          </h1>
        </div>

        <Card className="max-w-3xl mx-auto shadow-2xl border border-white/20 bg-white/10 backdrop-blur-md">
          <CardContent className="p-8">
            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Profile Picture Section */}
              <div className="flex flex-col items-center space-y-4">
                <div className="relative">
                  <div className="w-32 h-32 rounded-full bg-white/20 backdrop-blur-lg border-4 border-white/30 flex items-center justify-center overflow-hidden">
                    {profilePicture ? (
                      <img
                        src={profilePicture}
                        alt="Profile"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <UserIcon className="w-16 h-16 text-white/60" />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute bottom-0 right-0 w-10 h-10 rounded-full bg-white/20 backdrop-blur-lg border-2 border-white/40 flex items-center justify-center hover:bg-white/30 transition-all"
                  >
                    <Camera className="w-5 h-5 text-white" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                </div>
                <p className="text-white/70 text-sm">
                  Click the camera icon to upload a new photo
                </p>
              </div>

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

              {/* Name Field */}
              <div className="space-y-3">
                <Label htmlFor="name" className="text-white/80 text-lg">
                  Name
                </Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="John Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-12 text-lg"
                />
              </div>

              {/* Email Field */}
              <div className="space-y-3">
                <Label htmlFor="email" className="text-white/80 text-lg">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-12 text-lg"
                />
              </div>

              {/* Password Section */}
              <div className="space-y-4 pt-4 border-t border-white/20">
                <h3 className="text-white text-xl font-semibold">
                  Change Password
                </h3>
                <p className="text-white/70 text-sm">
                  Leave blank to keep current password
                </p>

                <div className="space-y-3">
                  <Label htmlFor="password" className="text-white/80 text-lg">
                    New Password
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                    minLength={8}
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-12 text-lg"
                  />
                  {password.length > 0 && password.length < 8 && (
                    <p className="text-sm text-red-400">
                      Must be at least 8 characters
                    </p>
                  )}
                </div>

                <div className="space-y-3">
                  <Label
                    htmlFor="confirmPassword"
                    className="text-white/80 text-lg"
                  >
                    Confirm New Password
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                    minLength={8}
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-12 text-lg"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex justify-center pt-6">
                <Button
                  type="submit"
                  className="w-1/2 bg-white/10 hover:bg-white/20 backdrop-blur-lg border border-white/30 text-white shadow-[0_8px_32px_0_rgba(255,255,255,0.1)] transition-all duration-300 hover:shadow-[0_8px_32px_0_rgba(255,255,255,0.2)] h-14 text-lg font-semibold"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
