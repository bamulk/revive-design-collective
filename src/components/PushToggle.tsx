"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";

interface Props {
  /** VAPID public key, base64-url encoded. Server-rendered into props. */
  publicKey: string;
}

type Status =
  | "unsupported" // browser/iOS doesn't support web push at all
  | "denied" // user previously blocked notifications
  | "off" // supported, allowed, not subscribed
  | "on" // active subscription
  | "loading"; // mid-request

/**
 * iOS quirks worth knowing:
 *   - Push only works when the PWA is added to the home screen.
 *     `window.matchMedia('(display-mode: standalone)').matches` is the
 *     reliable signal.
 *   - First-time permission MUST come from a user gesture (button click)
 *     or Safari ignores it.
 */
export default function PushToggle({ publicKey }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari uses navigator.standalone instead of the media query
      (navigator as any).standalone === true;
    setIsStandalone(standalone);

    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setStatus("unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }

    // Check whether we already have an active subscription.
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => {
        if (!reg) {
          setStatus("off");
          return;
        }
        reg.pushManager.getSubscription().then((sub) => {
          setStatus(sub ? "on" : "off");
        });
      })
      .catch(() => setStatus("off"));
  }, []);

  async function enable() {
    setStatus("loading");
    try {
      // Make sure the SW is registered.
      let reg = await navigator.serviceWorker.getRegistration("/");
      if (!reg) {
        reg = await navigator.serviceWorker.register("/sw.js");
      }
      // Wait for it to become active.
      if (!reg.active) {
        await new Promise<void>((resolve) => {
          const sw = reg!.installing || reg!.waiting;
          if (!sw) return resolve();
          sw.addEventListener("statechange", () => {
            if (sw.state === "activated") resolve();
          });
        });
      }

      // Ask permission inside the user-gesture chain.
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "off");
        return;
      }

      // Cast to BufferSource — TS gets confused about Uint8Array vs ArrayBuffer types here.
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      // POST the subscription to the server.
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      if (!res.ok) throw new Error(`subscribe failed: ${res.status}`);

      setStatus("on");
    } catch (err) {
      console.error("[push-toggle] enable failed:", err);
      setStatus("off");
      alert(
        "Couldn't enable notifications. " +
          (err instanceof Error ? err.message : ""),
      );
    }
  }

  async function disable() {
    setStatus("loading");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch (err) {
      console.error("[push-toggle] disable failed:", err);
      setStatus("on");
    }
  }

  // iOS-specific guidance.
  const isIOS = /iPhone|iPad|iPod/.test(
    typeof navigator !== "undefined" ? navigator.userAgent : "",
  );
  if (isIOS && !isStandalone && status !== "loading") {
    return (
      <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-lg px-3 py-2">
        To enable push on iPhone: tap{" "}
        <span className="font-medium">Share → Add to Home Screen</span>, then
        reopen the app and tap this button again.
      </div>
    );
  }

  if (status === "loading") {
    return (
      <button
        disabled
        className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400"
      >
        <Loader2 size={14} className="animate-spin" />
        Checking…
      </button>
    );
  }
  if (status === "unsupported") {
    return (
      <div className="text-xs text-slate-500 dark:text-slate-400">
        This browser doesn&apos;t support push notifications.
      </div>
    );
  }
  if (status === "denied") {
    return (
      <div className="text-xs text-slate-500 dark:text-slate-400">
        Notifications are blocked. Re-enable them in your browser settings.
      </div>
    );
  }
  if (status === "on") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={disable}
          className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
        >
          <Bell size={14} />
          Notifications on (tap to turn off)
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              const res = await fetch("/api/push/test", { method: "POST" });
              const json = await res.json().catch(() => ({}));
              if (!res.ok || !json.ok) {
                alert(
                  "Test failed: " +
                    (json.error || `HTTP ${res.status}`),
                );
                return;
              }
              if (json.sent === 0) {
                alert(
                  "Server says it sent 0 pushes — your subscription may be stale. Try toggling off and on.",
                );
              }
            } catch (err) {
              alert(
                "Test failed: " +
                  (err instanceof Error ? err.message : String(err)),
              );
            }
          }}
          className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900"
        >
          Send test
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={enable}
      className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-800 dark:text-slate-200"
    >
      <BellOff size={14} />
      Enable push notifications
    </button>
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
  return out;
}
