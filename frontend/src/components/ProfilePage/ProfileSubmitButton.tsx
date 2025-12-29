import React from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface ProfileSubmitButtonProps {
  loading: boolean;
}

export const ProfileSubmitButton: React.FC<ProfileSubmitButtonProps> = ({
  loading,
}) => {
  return (
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
  );
};
