import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface BasicInfoFieldsProps {
  name: string;
  email: string;
  loading: boolean;
  onNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
}

export const BasicInfoFields: React.FC<BasicInfoFieldsProps> = ({
  name,
  email,
  loading,
  onNameChange,
  onEmailChange,
}) => {
  return (
    <>
      <div className="space-y-3">
        <Label htmlFor="name" className="text-white/80 text-lg">
          Name
        </Label>
        <Input
          id="name"
          type="text"
          placeholder="John Doe"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={loading}
          className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-12 text-lg"
        />
      </div>

      <div className="space-y-3">
        <Label htmlFor="email" className="text-white/80 text-lg">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          required
          disabled={loading}
          className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-12 text-lg"
        />
      </div>
    </>
  );
};
