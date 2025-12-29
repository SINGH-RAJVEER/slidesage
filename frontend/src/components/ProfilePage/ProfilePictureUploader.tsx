import React, { useRef } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, User as UserIcon } from "lucide-react";

interface ProfilePictureUploaderProps {
  profilePicture: string;
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const ProfilePictureUploader: React.FC<ProfilePictureUploaderProps> = ({
  profilePicture,
  onImageUpload,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
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
          onChange={onImageUpload}
          className="hidden"
        />
      </div>
      <p className="text-white/70 text-sm">
        Click the camera icon to upload a new photo
      </p>
    </div>
  );
};
