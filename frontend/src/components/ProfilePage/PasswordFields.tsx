import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PasswordFieldsProps {
  password: string;
  confirmPassword: string;
  loading: boolean;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
}

export const PasswordFields: React.FC<PasswordFieldsProps> = ({
  password,
  confirmPassword,
  loading,
  onPasswordChange,
  onConfirmPasswordChange,
}) => {
  return (
    <div className="space-y-4 pt-4 border-t border-white/20">
      <h3 className="text-white text-xl font-semibold">Change Password</h3>
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
          onChange={(e) => onPasswordChange(e.target.value)}
          disabled={loading}
          minLength={8}
          className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-12 text-lg"
        />
        {password && (
          <p className="text-sm text-white/60">
            Password must be at least 8 characters long and contain at least one
            uppercase letter and one number
          </p>
        )}
      </div>

      <div className="space-y-3">
        <Label htmlFor="confirmPassword" className="text-white/80 text-lg">
          Confirm New Password
        </Label>
        <Input
          id="confirmPassword"
          type="password"
          placeholder="••••••••"
          value={confirmPassword}
          onChange={(e) => onConfirmPasswordChange(e.target.value)}
          disabled={loading}
          minLength={8}
          className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-12 text-lg"
        />
      </div>
    </div>
  );
};
