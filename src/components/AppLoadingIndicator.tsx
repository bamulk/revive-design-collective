import Image from "next/image";

/**
 * Minimal "we're working" indicator used by BOTH the route-segment
 * cold-start loader (src/app/(app)/loading.tsx) AND the client-side
 * route-transition overlay (RouteLoader).
 *
 * Just the dark/gold app icon, gently pulsing in the middle of the
 * viewport. No wordmark, no caption, no progress bar — same icon as
 * the iOS Home Screen / favicon, so loading reads as "this app is
 * thinking" without extra chrome.
 *
 * Animation is pure CSS so it works inside Next's loading.tsx boundary
 * (which can't host client components at the root).
 */
export default function AppLoadingIndicator() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--background)]">
      <div
        className="w-20 h-20 rounded-2xl shadow-lg overflow-hidden shs-pulse"
        aria-label="Loading"
        role="status"
      >
        <Image
          src="/icon.png"
          alt=""
          width={160}
          height={160}
          className="w-full h-full object-cover"
          priority
        />
      </div>

      <style>{`
        @keyframes shs-pulse {
          0%, 100% { transform: scale(1);   opacity: 1; }
          50%      { transform: scale(0.92); opacity: 0.78; }
        }
        .shs-pulse {
          animation: shs-pulse 1.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
