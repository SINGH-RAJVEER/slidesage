import { SignedIn, SignedOut } from "@clerk/clerk-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";

function buildRedirectUrl(location: ReturnType<typeof useLocation>) {
  const current = `${location.pathname}${location.search}${location.hash}`;
  const redirectUrl = encodeURIComponent(current);
  return `/sign-in?redirect_url=${redirectUrl}`;
}

export default function RequireSignedInLayout() {
  const location = useLocation();

  return (
    <>
      <SignedIn>
        <Outlet />
      </SignedIn>
      <SignedOut>
        <Navigate to={buildRedirectUrl(location)} replace />
      </SignedOut>
    </>
  );
}
