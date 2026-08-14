import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { BOOSTY_SLOT_CLASS } from "./BoostySupportSlot";

const SCRIPT_SRC = "https://portal.boosty.digital/boosty-support.js";

/** Publishable widget key: it is meant to ship in the client bundle. */
const PUBLIC_KEY = "bw_pk_be1c117cbb82917c9ff1aaf80086b589";

declare global {
  interface Window {
    BoostySupport?: {
      config: { userName: string; userEmail: string };
      open: () => void;
      close: () => void;
    };
  }
}

/**
 * Loads the Boosty support widget for the signed-in user.
 *
 * The script reads its whole configuration once, from the attributes on its own
 * tag, so a static tag in index.html could never carry the reporter identity.
 * Injecting it here lets every ticket arrive with the real name and email.
 *
 * It also waits for a header slot to exist before loading: the widget falls back
 * to a floating button when its mount target is missing for 10s, and a number of
 * portal screens render with no header at all.
 */
export function BoostySupport() {
  const { user, isAuthenticated } = useAuth();

  const userName = user ? `${user.nombre ?? ""} ${user.apellido ?? ""}`.trim() : "";
  const userEmail = user?.email ?? "";

  useEffect(() => {
    if (!isAuthenticated || !userName || !userEmail) return;

    // Already loaded. The reporter is read from this object when a ticket is
    // sent, so a new session only needs the identity refreshed, not a reload.
    const loaded = window.BoostySupport;
    if (loaded) {
      loaded.config.userName = userName;
      loaded.config.userEmail = userEmail;
      return;
    }

    if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return;

    let observer: MutationObserver | null = null;

    const injectScript = () => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.setAttribute("data-boosty-key", PUBLIC_KEY);
      script.setAttribute("data-boosty-mount", `.${BOOSTY_SLOT_CLASS}`);
      script.setAttribute("data-boosty-user-name", userName);
      script.setAttribute("data-boosty-user-email", userEmail);
      document.body.appendChild(script);
    };

    const hasSlot = () => document.querySelector(`.${BOOSTY_SLOT_CLASS}`) !== null;

    if (hasSlot()) {
      injectScript();
    } else {
      observer = new MutationObserver(() => {
        if (!hasSlot()) return;
        observer?.disconnect();
        observer = null;
        injectScript();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => observer?.disconnect();
  }, [isAuthenticated, userName, userEmail]);

  return null;
}
