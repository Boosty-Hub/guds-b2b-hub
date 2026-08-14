import { useEffect, useRef } from "react";

/** Attribute the widget stamps on the trigger button it renders. */
const TRIGGER_SELECTOR = "[data-boosty-support-trigger]";

/** Class the widget script targets through data-boosty-mount. */
export const BOOSTY_SLOT_CLASS = "boosty-support-slot";

/**
 * Deliberately outside the component. Once React unmounts the header holding the
 * trigger, the node is detached and `document.querySelector` can no longer reach
 * it, so the reference has to outlive any individual slot.
 */
let capturedTrigger: Element | null = null;

function findTrigger(): Element | null {
  if (!capturedTrigger) {
    capturedTrigger = document.querySelector(TRIGGER_SELECTOR);
  }
  return capturedTrigger;
}

interface BoostySupportSlotProps {
  /**
   * Media query that must match for this slot to hold the button. Layouts that
   * keep a mobile and a desktop header mounted at the same time pass
   * complementary queries so only the visible one claims it.
   */
  media?: string;
  className?: string;
}

/**
 * Anchor for the Boosty support button inside a header.
 *
 * The widget script mounts its trigger once and then disconnects its observer,
 * so the button would disappear the first time React unmounts the header that
 * holds it. Each slot re-adopts the existing trigger on mount instead:
 * appendChild moves the node, preserving its shadow root and click handler.
 */
export function BoostySupportSlot({ media, className }: BoostySupportSlotProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const query = media ? window.matchMedia(media) : null;
    let observer: MutationObserver | null = null;

    /** Returns true once the trigger exists, whether or not this slot took it. */
    const settle = () => {
      const trigger = findTrigger();
      if (!trigger) return false;
      if ((!query || query.matches) && trigger.parentNode !== host) {
        host.appendChild(trigger);
      }
      return true;
    };

    if (!settle()) {
      observer = new MutationObserver(() => {
        if (settle()) {
          observer?.disconnect();
          observer = null;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    // Crossing the breakpoint hands the button to the header that is now visible.
    query?.addEventListener("change", settle);

    return () => {
      observer?.disconnect();
      query?.removeEventListener("change", settle);
      // This header is going away. If it is holding the button, keep a
      // reference now: once React detaches the subtree the node is no longer
      // reachable through `document`, and the next slot could never find it.
      const held = host.querySelector(TRIGGER_SELECTOR);
      if (held) capturedTrigger = held;
    };
  }, [media]);

  return (
    <div
      ref={hostRef}
      className={`${BOOSTY_SLOT_CLASS} flex items-center empty:hidden${
        className ? ` ${className}` : ""
      }`}
    />
  );
}
