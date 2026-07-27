"use client";

import { useEffect, useState } from "react";

/**
 * True while the on-screen keyboard is (very likely) open — i.e. a
 * text-entry element has focus.
 *
 * Why: iOS Safari ignores the `interactive-widget` viewport setting, so
 * when the keyboard opens it re-anchors `position: fixed` elements
 * against the shrunken visual viewport — the bottom tab bar ends up
 * floating mid-screen, and often STAYS there after the keyboard closes.
 * The dependable fix is to hide fixed-bottom chrome while typing and
 * nudge the scroll position on close so Safari re-anchors everything.
 *
 * SELECTs are excluded (iOS shows a picker wheel, not a keyboard) so
 * sort/filter dropdowns don't blink the nav.
 */
function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return ![
      "checkbox",
      "radio",
      "button",
      "submit",
      "reset",
      "file",
      "range",
      "color",
      "hidden",
    ].includes(type);
  }
  return false;
}

export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const onFocusIn = (e: FocusEvent) => {
      if (!isTextEntry(e.target)) return;
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      setOpen(true);
    };

    const onFocusOut = (e: FocusEvent) => {
      if (!isTextEntry(e.target)) return;
      // Small delay so tabbing between fields doesn't flicker the nav.
      hideTimer = setTimeout(() => {
        setOpen(false);
        // Nudge Safari into re-anchoring position:fixed elements — a
        // dismissed keyboard can otherwise leave them stranded
        // mid-viewport until the next scroll.
        window.scrollBy(0, -1);
        window.scrollBy(0, 1);
      }, 250);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return open;
}
