import { SpeedInsights } from "@vercel/speed-insights/react";
import { Analytics } from "@vercel/analytics/react";
import { RouterProvider } from "react-router-dom";
import { ClerkLoaded, ClerkLoading } from "@clerk/clerk-react";
import { StreamingProvider } from "@/modules/presentations";
import { router } from "@/router/router";

export default function App() {
  return (
    <StreamingProvider>
      <SpeedInsights />
      <Analytics />
      <ClerkLoading>
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center px-6">
          <div className="text-center">
            <div className="text-white text-xl font-semibold">Loading…</div>
            <div className="text-white/60 mt-2">
              Initializing authentication
            </div>
          </div>
        </div>
      </ClerkLoading>

      <ClerkLoaded>
        <RouterProvider router={router} />
      </ClerkLoaded>
    </StreamingProvider>
  );
}
