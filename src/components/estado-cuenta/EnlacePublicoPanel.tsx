import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, History, Link2, Link2Off, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { fechaHora, fechaLarga, urlEstadoCuenta } from "./formato";

// Enlace público del estado de cuenta (fase 20w) en CuentaDetalle: generar (o reutilizar el activo), copiar, abrir, ver
// sus accesos, pedir uno nuevo (revoca el anterior) y revocar con confirmación. El token solo llega si el usuario puede
// compartir (cuentas editar); con permiso de ver solo se muestra el estado del enlace.

export interface EnlaceEstadoCuenta {
  id: string;
  token: string | null;
  activo: boolean;
  creado_at: string;
  creado_por: string | null;
  vence_at: string | null;
  revocado_at: string | null;
  revocado_por: string | null;
  revocado_motivo: "revocado" | "reemplazado" | "vencido" | null;
  ultimo_acceso_at: string | null;
  accesos: number;
}

const MOTIVO: Record<string, string> = { revocado: "Revocado", reemplazado: "Reemplazado", vencido: "Vencido" };

const hoyCaracas = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
const sumarDias = (f: string, n: number) => {
  const d = new Date(`${f}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
};

export function EnlacePublicoPanel({ clienteId, puedeEditar, onEnlace, recargarSenal = 0 }: {
  clienteId: string;
  puedeEditar: boolean;
  /** Avisa la URL del enlace activo (o null) para el pie del PDF y el correo. */
  onEnlace?: (url: string | null) => void;
  /** Cambia este número para recargar (p. ej. tras enviar un correo, que puede crear el enlace). */
  recargarSenal?: number;
}) {
  const [enlaces, setEnlaces] = useState<EnlaceEstadoCuenta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [vence, setVence] = useState("");
  const [confirmar, setConfirmar] = useState<"nuevo" | "revocar" | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);

  const cargar = useCallback(async () => {
    const { data, error: err } = await supabase.rpc("enlaces_estado_cuenta", { p_cliente_id: clienteId });
    if (err) { setError(err.message); setEnlaces([]); return; }
    setError(null);
    setEnlaces((data as EnlaceEstadoCuenta[]) ?? []);
  }, [clienteId]);

  useEffect(() => { cargar(); }, [cargar, recargarSenal]);

  const activo = enlaces?.find((e) => e.activo) ?? null;
  const url = activo?.token ? urlEstadoCuenta(activo.token) : null;
  const historial = (enlaces ?? []).filter((e) => !e.activo);
  useEffect(() => { onEnlace?.(url); }, [url, onEnlace]);

  const crear = async (nuevo: boolean) => {
    setTrabajando(true);
    const { data, error: err } = await supabase.rpc("crear_enlace_estado_cuenta", {
      p_cliente_id: clienteId, p_nuevo: nuevo, p_vence: vence || null,
    });
    setTrabajando(false);
    setConfirmar(null);
    if (err) { toast({ title: "No se pudo generar el enlace", description: err.message, variant: "destructive" }); return; }
    const e = data as EnlaceEstadoCuenta & { reutilizado: boolean };
    toast({ title: e.reutilizado ? "Ya había un enlace activo" : nuevo ? "Enlace nuevo generado" : "Enlace generado",
      description: e.reutilizado ? "Se reutiliza el mismo enlace." : nuevo ? "El enlace anterior dejó de funcionar." : "Cópialo y compártelo con el cliente." });
    setVence("");
    await cargar();
  };

  const revocar = async () => {
    if (!activo) return;
    setTrabajando(true);
    const { error: err } = await supabase.rpc("revocar_enlace_estado_cuenta", { p_enlace_id: activo.id });
    setTrabajando(false);
    setConfirmar(null);
    if (err) { toast({ title: "No se pudo revocar", description: err.message, variant: "destructive" }); return; }
    toast({ title: "Enlace revocado", description: "Quien lo abra verá que ya no está disponible." });
    await cargar();
  };

  const copiar = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast({ title: "No se pudo copiar", description: "Selecciona el enlace y cópialo a mano.", variant: "destructive" });
    }
  };

  const hoy = hoyCaracas();

  return (
    <div className="rounded-lg border border-border bg-card" data-testid="ec-enlace">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 p-1.5"><Link2 className="h-4 w-4 text-primary" /></div>
          <h2 className="text-[13px] font-semibold">Enlace público</h2>
          {activo ? <Badge className="px-1.5 py-0 text-[10px]">Activo</Badge> : enlaces && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">Sin enlace</Badge>}
        </div>
        {historial.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setVerHistorial((v) => !v)} aria-expanded={verHistorial}>
            <History className="h-3.5 w-3.5" />Historial ({historial.length})
          </Button>
        )}
      </div>
      <div className="space-y-3 p-3">
        {enlaces === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando…</div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : activo ? (
          <>
            {url ? (
              <div className="flex gap-2">
                <Input readOnly value={url} className="h-8 min-w-0 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} aria-label="Enlace público" data-testid="ec-enlace-url" />
                <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5" onClick={copiar} data-testid="ec-enlace-copiar">
                  {copiado ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}{copiado ? "Copiado" : "Copiar"}
                </Button>
                <Button size="sm" variant="outline" className="h-8 w-8 shrink-0 p-0" asChild>
                  <a href={url} target="_blank" rel="noreferrer noopener" aria-label="Abrir enlace"><ExternalLink className="h-3.5 w-3.5" /></a>
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Hay un enlace activo. Para copiarlo necesitas permiso de edición en Cuentas.</p>
            )}
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Creado</dt><dd className="text-right">{fechaHora(activo.creado_at)}{activo.creado_por ? ` · ${activo.creado_por}` : ""}</dd>
              <dt className="text-muted-foreground">Accesos</dt><dd className="text-right tabular-nums" data-testid="ec-enlace-accesos">{activo.accesos}</dd>
              <dt className="text-muted-foreground">Último acceso</dt><dd className="text-right">{activo.ultimo_acceso_at ? fechaHora(activo.ultimo_acceso_at) : "Aún no se abre"}</dd>
              <dt className="text-muted-foreground">Vence</dt><dd className="text-right">{activo.vence_at ? fechaLarga(new Date(new Date(activo.vence_at).getTime() - 1).toISOString()) : "Sin vencimiento"}</dd>
            </dl>
            {puedeEditar && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setConfirmar("nuevo")} disabled={trabajando} data-testid="ec-enlace-nuevo">
                  <RefreshCw className="h-3.5 w-3.5" />Generar uno nuevo
                </Button>
                <Button size="sm" variant="outline" className="h-8 gap-1.5 text-destructive hover:text-destructive" onClick={() => setConfirmar("revocar")} disabled={trabajando} data-testid="ec-enlace-revocar">
                  <Link2Off className="h-3.5 w-3.5" />Revocar
                </Button>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              El cliente verá su estado de cuenta en tiempo real, sin iniciar sesión. Puedes revocarlo cuando quieras.
            </p>
            {puedeEditar ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor="ec-vence" className="text-xs">Vence (opcional)</Label>
                  <Input id="ec-vence" type="date" className="h-8 w-40 text-xs" value={vence} min={hoy} max={sumarDias(hoy, 365)}
                    onChange={(e) => setVence(e.target.value)} />
                </div>
                <Button size="sm" className="h-8 gap-1.5" onClick={() => crear(false)} disabled={trabajando} data-testid="ec-enlace-generar">
                  {trabajando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}Generar enlace
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Necesitas permiso de edición en Cuentas para generar el enlace.</p>
            )}
          </>
        )}

        {verHistorial && historial.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border text-xs" data-testid="ec-enlace-historial">
            {historial.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                <span className="min-w-0 truncate text-muted-foreground">
                  {fechaLarga(e.creado_at)}{e.creado_por ? ` · ${e.creado_por}` : ""} · {e.accesos} {e.accesos === 1 ? "acceso" : "accesos"}
                </span>
                <span className={cn("shrink-0", e.revocado_motivo === "revocado" ? "text-destructive" : "text-muted-foreground")}>
                  {MOTIVO[e.revocado_motivo ?? ""] ?? "Inactivo"}{e.revocado_at ? ` ${fechaLarga(e.revocado_at)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog open={confirmar !== null} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmar === "revocar" ? "¿Revocar el enlace?" : "¿Generar un enlace nuevo?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmar === "revocar"
                ? "El enlace dejará de funcionar al instante. Quien lo abra verá que ya no está disponible. Puedes generar otro cuando quieras."
                : "El enlace actual dejará de funcionar al instante y se creará uno nuevo para compartir."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmar === "nuevo" && (
            <div className="space-y-1">
              <Label htmlFor="ec-vence-nuevo" className="text-xs">Vence (opcional)</Label>
              <Input id="ec-vence-nuevo" type="date" className="h-8 w-44 text-xs" value={vence} min={hoy} max={sumarDias(hoy, 365)}
                onChange={(e) => setVence(e.target.value)} />
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={trabajando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={confirmar === "revocar" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
              disabled={trabajando}
              onClick={(ev) => { ev.preventDefault(); if (confirmar === "revocar") revocar(); else crear(true); }}
              data-testid="ec-enlace-confirmar"
            >
              {trabajando && <Loader2 className="h-4 w-4 animate-spin" />}{confirmar === "revocar" ? "Revocar enlace" : "Generar nuevo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
