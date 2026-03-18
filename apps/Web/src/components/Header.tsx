import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/router/paths";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Header() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isAuthPage =
    location.pathname === ROUTES.signIn ||
    location.pathname === ROUTES.signUp ||
    location.pathname.startsWith(`${ROUTES.signIn}/`) ||
    location.pathname.startsWith(`${ROUTES.signUp}/`);

  const isActive = (path: string) => {
    if (
      path === ROUTES.presentations &&
      location.pathname === ROUTES.presentations
    )
      return true;
    if (
      path === ROUTES.generate &&
      (location.pathname === ROUTES.generate ||
        location.pathname === ROUTES.research)
    )
      return true;
    return location.pathname.startsWith(path) && path !== ROUTES.home;
  };

  return (
    <header className="border-b border-white/10 bg-black/10">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 md:px-6">
        {/* Left Side: Logo */}
        <div className="flex items-center w-1/3">
          <Link to={ROUTES.home} aria-label="Go to home">
            <img
              src="/icon.png"
              alt="SlideSage"
              className="h-10 w-auto object-contain"
            />
          </Link>
        </div>

        {/* Center: Tabs */}
        {!isAuthPage ? (
          <div className="flex-1 flex justify-center w-1/3">
            <nav className="flex items-center gap-1">
              <Link
                to={ROUTES.generate}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive(ROUTES.generate)
                    ? "bg-white/10 text-white"
                    : "text-white/70 hover:bg-white/5 hover:text-white",
                )}
              >
                Generate
              </Link>
              <Link
                to={ROUTES.presentations}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive(ROUTES.presentations)
                    ? "bg-white/10 text-white"
                    : "text-white/70 hover:bg-white/5 hover:text-white",
                )}
              >
                Presentations
              </Link>
            </nav>
          </div>
        ) : (
          <div className="flex-1 w-1/3"></div>
        )}

        {/* Right Side: Profile / Points */}
        <div className="flex items-center justify-end w-1/3 gap-3">
          {user && (
            <>
              <button
                type="button"
                onClick={() => navigate(ROUTES.purchase)}
                className="rounded-full border border-white/10 px-4 py-1.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/20"
                title="Click to purchase more points"
              >
                {user.slideTokens === Infinity
                  ? "∞ points"
                  : `${user.slideTokens?.toFixed(1) ?? "0.0"} points`}
              </button>

              <DropdownMenu>
                <DropdownMenuTrigger className="focus:outline-none rounded-full ring-offset-black focus:ring-2 focus:ring-white/20 transition-all">
                  <div className="h-9 w-9 overflow-hidden rounded-full border border-white/20 bg-white/10 transition-colors hover:border-white/40 flex items-center justify-center shadow-sm">
                    <span className="text-sm font-semibold text-white/90 uppercase flex-shrink-0">
                      {user.email?.charAt(0) || "U"}
                    </span>
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 bg-zinc-950/95 backdrop-blur-md border border-white/10 text-white shadow-xl rounded-xl p-1.5">
                  <div className="px-2 py-2">
                    <p className="text-xs font-medium text-white/60 uppercase tracking-wider mb-1">Signed in as</p>
                    <p className="font-normal text-white/90 text-sm truncate">{user.email}</p>
                  </div>
                  <DropdownMenuSeparator className="bg-white/10 my-1" />
                  <DropdownMenuItem asChild className="p-0 rounded-lg overflow-hidden cursor-pointer">
                    <Link to={ROUTES.profile} className="block w-full px-2 py-2 text-sm text-white/90 hover:bg-white/10 transition-colors outline-none focus:bg-white/10">
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-white/10 my-1" />
                  <DropdownMenuItem 
                    onClick={() => signOut()}
                    className="cursor-pointer px-2 py-2 text-sm rounded-lg text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors focus:bg-red-500/10 outline-none"
                  >
                    Sign Out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
