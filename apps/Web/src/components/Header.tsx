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
    <header className="border-b border-white/10 bg-black/10">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6">
        <div className="flex items-center gap-4">
          <Link to={ROUTES.home} aria-label="Go to home">
            <img
              src="/icon.png"
              alt="SlideSage"
              className="h-10 w-auto object-contain"
            />
          </Link>

          {!isAuthPage && (
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
          )}
        </div>

        {user && (
          <div className="flex items-center gap-2 md:gap-3">
            <button
              type="button"
              onClick={() => navigate(ROUTES.purchase)}
              className="rounded-md border border-white/10 px-3 py-2 text-sm text-white/90 transition-colors hover:bg-white/5"
              title="Click to purchase more points"
            >
              {user.slideTokens === Infinity
                ? "∞ points"
                : `${user.slideTokens?.toFixed(1) ?? "0.0"} points`}
            </button>

            <span className="hidden text-sm text-white/70 lg:block">
              {user.email}
            </span>
            <Link
              to={ROUTES.profile}
              className="rounded-md px-3 py-2 text-sm text-white/90 transition-colors hover:bg-white/10"
            >
              Profile
            </Link>
            <button
              type="button"
              onClick={() => signOut()}
              className="rounded-md px-3 py-2 text-sm text-white/90 transition-colors hover:bg-white/10"
            >
              Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
