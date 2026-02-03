import { ClerkLoaded, ClerkLoading } from "@clerk/clerk-react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { RouterProvider } from "react-router-dom";
import { StreamingProvider } from "@/modules/presentations";
import { router } from "@/router/router";
import { Spinner } from "@/components/ui/spinner";
import { Suspense } from "react";

export default function App() {
  return (
    <StreamingProvider>
      <SpeedInsights />
      <Analytics />
      <ClerkLoading>
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center px-6">
          <div className="text-center flex flex-col items-center gap-3">
            <Spinner />
          </div>
        </div>
      </ClerkLoading>

      <ClerkLoaded>
        <Suspense
          fallback={
            <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center px-6">
              <div className="text-center flex flex-col items-center gap-3">
                <Spinner />
                <div className="text-white text-xl font-semibold">Loading…</div>
                <div className="text-white/60 mt-2">Loading the page</div>
              </div>
            </div>
          }
        >
          <RouterProvider router={router} />
        </Suspense>
      </ClerkLoaded>
    </StreamingProvider>
  );
}
