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
    // Profile page - does nothing for now
    console.log("Profile clicked");
  };

  // Get user initials for avatar placeholder
  const getUserInitials = (email: string) => {
    return email.charAt(0).toUpperCase();
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm hover:shadow-lg hover:scale-105 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent"
                  title={user.email}
                >
                  {getUserInitials(user.email)}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-48 border-white/20 bg-white/10 backdrop-blur-md shadow-2xl text-white"
              >
                <div className="px-2 py-1.5 text-sm text-white/60">
                  {user.email}
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
