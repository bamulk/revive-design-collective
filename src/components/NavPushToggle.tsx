"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";

interface Props {
  publicKey: string;
}

type Status = "unsupported" | "denied" | "off" | "on" | "loading";

/**
 * Compact bell-icon push toggle for the top nav bar.
 * - Outlined bell → notifications off
 * - Filled brand-colored bell → notifications on
 *
 * On iOS PWA outside standalone mode, tapping shows an alert with
 * "Add to Home Screen" guidance instead of trying (and failing) to
 * subscribe.
 */
export default function NavPushToggle({ publicKey }: Props) {
  const [status, setStatus] = useState<Status>("loading");
  const [isStandalone, setIsStandalone] = useState(true);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsIOS(/iPhone|iPad|iPod/.test(navigator.userAgent));
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
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
    if (isIOS && !isStandalone) {
      alert(
        "To enable notifications on iPhone:\n" +
          "1. Tap Share → Add to Home Screen\n" +
          "2. Open the app from your home screen\n" +
          "3. Then tap this bell again.",
      );
      return;
    }
    setStatus("loading");
    try {
      let reg = await navigator.serviceWorker.getRegistration("/");
      if (!reg) reg = await navigator.serviceWorker.register("/sw.js");
      if (!reg.active) {
        await new Promise<void>((resolve) => {
          const sw = reg!.installing || reg!.waiting;
          if (!sw) return resolve();
          sw.addEventListener("statechange", () => {
            if (sw.state === "activated") resolve();
          });
        });
      }
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "off");
        if (perm === "denied") {
          alert(
            "Notifications are blocked. Re-enable them in your browser/iOS settings.",
          );
        }
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(json),
      });
      if (!res.ok) throw new Error(`subscribe failed: ${res.status}`);
      setStatus("on");
    } catch (err) {
      console.error("[nav-push] enable failed:", err);
      setStatus("off");
      alert(
        "Couldn't enable notifications: " +
          (err instanceof Error ? err.message : String(err)),
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
      console.error("[nav-push] disable failed:", err);
      setStatus("on");
    }
  }

  // Don't render anything while we figure out the state — keeps the
  // nav bar from flickering between states on every page load.
  if (status === "loading") {
    return (
      <button
        type="button"
        disabled
        aria-label="Loading notifications status"
        className="inline-flex items-center justify-center w-9 h-9 rounded-md text-slate-300"
      >
        <Bell size={18} />
      </button>
    );
  }
  if (status === "unsupported") return null;

  const onClick = status === "on" ? disable : enable;
  const Icon = status === "on" ? BellRing : status === "denied" ? BellOff : Bell;
  const label =
    status === "on"
      ? "Notifications on — tap to turn off"
      : status === "denied"
      ? "Notifications blocked — change in browser settings"
      : "Enable notifications";
  const tone =
    status === "on"
      ? "text-[var(--brand)] hover:bg-amber-50"
      : status === "denied"
      ? "text-slate-400 dark:text-slate-500 cursor-not-allowed"
      : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800";

  return (
    <button
      type="button"
      onClick={status === "denied" ? undefined : onClick}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-md transition ${tone}`}
    >
      <Icon size={18} strokeWidth={status === "on" ? 2.25 : 2} />
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
