import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { LogOut, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleProfileClick = () => {
    navigate("/profile");
  };

  // Get user initials for avatar placeholder
  const getUserInitials = (name: string) => {
    const nameParts = name.trim().split(" ");
    if (nameParts.length >= 2) {
      return (nameParts[0].charAt(0) + nameParts[1].charAt(0)).toUpperCase();
    }
    return name.charAt(0).toUpperCase();
  };

  return (
    <header className="border-b border-white/20 bg-white/5 backdrop-blur-md">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between h-18">
        <div className="flex items-center gap-2">
          <img
            src="/icon.png"
            alt="SlideSage"
            className="h-32 w-55 object-cover drop-shadow-2xl -my-8"
          />
        </div>

        {user && (
          <div className="flex items-center gap-4">
            {/* Slide Points Display */}
            <button
              onClick={() => navigate("/purchase")}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 hover:bg-white/20 hover:scale-105 transition-all duration-200 cursor-pointer"
              title="Click to purchase more points"
            >
              <span className="text-sm font-medium text-white">
                {user.slide_tokens?.toFixed(1) ?? "0.0"}
              </span>
              <span className="text-xs text-white/60">points</span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-14 w-14 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white font-semibold text-lg hover:bg-white/20 hover:scale-105 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent overflow-hidden"
                  title={user.email}
                >
                  {user.profile_picture ? (
                    <img
                      src={user.profile_picture}
                      alt="Profile"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    getUserInitials(user.name)
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-48 border-white/20 bg-white/10 backdrop-blur-md shadow-2xl text-white"
              >
                <div className="px-2 py-1.5 text-sm text-white/60">
                  {user.name || user.email}
                </div>
                <DropdownMenuSeparator className="bg-white/20" />
                <DropdownMenuItem
                  onClick={handleProfileClick}
                  className="text-white/80 focus:text-white focus:bg-white/20"
                >
                  <User className="h-4 w-4 mr-2" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-white/20" />
                <DropdownMenuItem
                  onClick={handleLogout}
                  variant="destructive"
                  className="text-red-400 focus:text-red-300 focus:bg-red-600/20"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Logout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </header>
  );
}
