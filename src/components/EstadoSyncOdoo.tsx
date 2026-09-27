import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/lib/supabase";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface Estado { ultima_ok: string | null; ultima_estado: string | null; ultima_error: string | null; ultima_inicio: string | null; en_curso: boolean; segundos: number | null }

const fecha = (s: string | null) => (s ? new Date(s).toLocaleString("es-VE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
// Horario de la sincronización automática: cada 15 min de 7:00 a 19:45 (Caracas, UTC-4), lunes a sábado
const enHorario = (d = new Date()) => {
  const caracas = new Date(d.getTime() - 4 * 3600000);
  const h = caracas.getUTCHours(), dia = caracas.getUTCDay();
  return dia !== 0 && h >= 7 && h < 20;
};

/** Estado de la sincronización Odoo → GUDS (función edge sync-odoo) con opción de sincronizar ahora. */
export function EstadoSyncOdoo({ className }: { className?: string }) {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [, setAhora] = useState(Date.now());
  const esperando = useRef(false);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("estado_sync_odoo");
    if (!error && Array.isArray(data) && data[0]) setEstado(data[0] as Estado);
    return (data as Estado[] | null)?.[0] ?? null;
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(() => { cargar(); setAhora(Date.now()); }, 60000);
    return () => clearInterval(t);
  }, [cargar]);

  const sincronizar = async () => {
    const { data, error } = await supabase.rpc("solicitar_sync_odoo");
    const r = data as { ok: boolean; mensaje: string } | null;
    if (error || !r) { toast({ title: "No se pudo sincronizar", description: error?.message, variant: "destructive" }); return; }
    toast({ title: r.ok ? "Sincronizando con Odoo" : "Sincronización en curso", description: r.mensaje });
    if (esperando.current) return;
    esperando.current = true;
    const previa = estado?.ultima_ok ?? null;
    // Seguimiento hasta que termine (máx. 3 min)
    for (let i = 0; i < 36; i++) {
      await new Promise((ok) => setTimeout(ok, 5000));
      const e = await cargar();
      if (e && !e.en_curso && e.ultima_inicio && (e.ultima_ok !== previa || e.ultima_estado === "error")) {
        toast(e.ultima_estado === "error"
          ? { title: "La sincronización falló", description: e.ultima_error ?? "", variant: "destructive" }
          : { title: "Sincronización terminada", description: `Datos de Odoo al día (${e.segundos ?? "?"} s)` });
        break;
      }
    }
    esperando.current = false;
  };

  if (!estado) return null;
  const minutos = estado.ultima_ok ? Math.max(0, Math.round((Date.now() - new Date(estado.ultima_ok).getTime()) / 60000)) : null;
  const error = estado.ultima_estado === "error";
  const atrasado = minutos === null || (enHorario() ? minutos > 45 : minutos > 24 * 60);
  const tono = estado.en_curso ? "bg-sky-500 animate-pulse" : error ? "bg-destructive" : atrasado ? "bg-amber-500" : "bg-emerald-500";
  const texto = estado.en_curso ? "Sincronizando…" : minutos === null ? "sin sincronizar" : minutos < 1 ? "ahora" : minutos < 60 ? `hace ${minutos} min` : minutos < 48 * 60 ? `hace ${Math.round(minutos / 60)} h` : `hace ${Math.round(minutos / 1440)} d`;

  return (
    <div className={cn("flex h-8 items-center gap-1 rounded-full border border-border bg-muted/50 pl-2.5 pr-1", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex cursor-default items-center gap-1.5 text-[12px]" aria-label={`Sincronización con Odoo: ${texto}`}>
            <span className={cn("h-2 w-2 rounded-full", tono)} />
            <span className="font-semibold uppercase tracking-wide text-muted-foreground text-[11px]">Odoo</span>
            <span className="tabular-nums text-foreground">{texto}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="text-xs">Última sincronización correcta: {fecha(estado.ultima_ok)}{estado.segundos ? ` (${estado.segundos} s)` : ""}</p>
          {error && <p className="text-xs text-destructive">Último intento con error: {estado.ultima_error}</p>}
          <p className="text-xs text-muted-foreground">Automática cada 15 min de 7:00 a 19:45 (lun–sáb) y cada noche. Odoo se lee en solo lectura.</p>
        </TooltipContent>
      </Tooltip>
      {can("configuracion", "editar") && (
        <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={sincronizar} disabled={estado.en_curso} title="Sincronizar ahora con Odoo" aria-label="Sincronizar ahora con Odoo">
          <RefreshCw className={cn("h-3.5 w-3.5", estado.en_curso && "animate-spin")} />
        </Button>
      )}
    </div>
  );
}
