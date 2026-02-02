import { useUser, UserButton } from "@clerk/clerk-react";
import { useNavigate } from "react-router-dom";

interface UserMetadata {
  is_unlimited?: boolean;
  slide_tokens?: number;
}

export default function Header() {
  const { user } = useUser();
  const navigate = useNavigate();

  const metadata = (user?.publicMetadata || {}) as UserMetadata;

  return (
    <header className="border-b border-white/20 bg-white/5 backdrop-blur-md">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between h-18">
        <div className="flex items-center gap-2">
          <img
            src="/icon.png"
            alt="SlideSage"
            className="h-32 w-60 object-contain drop-shadow-2xl -my-8"
          />
        </div>

        {user && (
          <div className="flex items-center gap-4">
            {/* Slide Points Display */}
            <button
              type="button"
              onClick={() => navigate("/purchase")}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 hover:bg-white/20 hover:scale-105 transition-all duration-200 cursor-pointer"
              title="Click to purchase more points"
            >
              <span className="text-sm font-medium text-white">
                {metadata.is_unlimited || metadata.slide_tokens === Infinity
                  ? "∞"
                  : (metadata.slide_tokens?.toFixed(1) ?? "0.0")}
              </span>
              <span className="text-xs text-white/60">points</span>
            </button>

            <UserButton
              afterSignOutUrl="/sign-in"
              appearance={{
                elements: {
                  avatarBox: "h-14 w-14",
                },
              }}
            />
          </div>
        )}
      </div>
    </header>
  );
}
