import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/router/paths";

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
    <header className="border-b border-white/10 bg-black/20 backdrop-blur-xl">
      <div className="container mx-auto px-6 py-4 flex items-center justify-between relative">
        <div className="flex items-center gap-2">
          <Link to={ROUTES.home} aria-label="Go to home">
            <img
              src="/icon.png"
              alt="SlideSage"
              className="h-16 w-auto object-contain drop-shadow-2xl -my-4"
            />
          </Link>
        </div>

        {/* Centered Navigation Tabs */}
        {!isAuthPage && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <nav className="flex items-center gap-1 p-1 bg-white/5 rounded-full border border-white/10 backdrop-blur-md">
              <Link
                to={ROUTES.generate}
                className={cn(
                  "px-8 py-3 rounded-full text-lg font-medium transition-all duration-300",
                  isActive(ROUTES.generate)
                    ? "bg-white/10 text-white shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                    : "text-white/60 hover:text-white hover:bg-white/5",
                )}
              >
                Generate
              </Link>
              <Link
                to={ROUTES.presentations}
                className={cn(
                  "px-8 py-3 rounded-full text-lg font-medium transition-all duration-300",
                  isActive(ROUTES.presentations)
                    ? "bg-white/10 text-white shadow-[0_0_15px_rgba(255,255,255,0.1)]"
                    : "text-white/60 hover:text-white hover:bg-white/5",
                )}
              >
                Presentations
              </Link>
            </nav>
          </div>
        )}

        {user && (
          <div className="flex items-center gap-4">
            {/* Slide Points Display */}
            <button
              type="button"
              onClick={() => navigate(ROUTES.purchase)}
              className="flex items-center gap-3 px-5 py-2.5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-200 cursor-pointer"
              title="Click to purchase more points"
            >
              <span className="text-lg font-medium text-white">
                {user.slideTokens === Infinity
                  ? "∞"
                  : (user.slideTokens?.toFixed(1) ?? "0.0")}
              </span>
              <span className="text-base text-white/50">points</span>
            </button>

            <div className="flex items-center gap-3">
              <span className="text-sm text-white">{user.email}</span>
              <Link
                to={ROUTES.profile}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
              >
                Profile
              </Link>
              <button
                type="button"
                onClick={() => signOut()}
                className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
