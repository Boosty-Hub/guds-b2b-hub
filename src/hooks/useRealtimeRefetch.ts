import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

let seq = 0;

/**
 * Refetch en vivo cuando cambia una tabla, vía Supabase Realtime.
 *
 * Cada llamada abre su PROPIO canal con un nombre único (tabla + contador +
 * timestamp) — nunca comparte topic entre componentes. El commit 325d460
 * dejó el portal en blanco porque dos suscriptores usaban el mismo nombre de
 * canal; este hook existe para que ese bug no se pueda repetir aquí.
 *
 * Incluye un poll de respaldo cada 60s por si el canal de Realtime no llega
 * a conectar (misma red de seguridad que ya usa NotificationsContext).
 */
export function useRealtimeRefetch(table: string, onChange: () => void, enabled: boolean = true) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;

    seq += 1;
    const channelName = `rt-${table}-${seq}-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => onChangeRef.current()
      )
      .subscribe();

    const poll = setInterval(() => onChangeRef.current(), 60000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [table, enabled]);
}
