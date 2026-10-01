import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useToast } from "@/hooks/use-toast";
import { BandejaTareas } from "./BandejaTareas";
import { CuadreResumen } from "./CuadreResumen";
import { useOdooBase, useResponsables, useSeccionCalidad, useTareas } from "./datos";
import type { Grupo } from "./tipos";

const haceCuanto = (v: string | null) => {
  if (!v) return "nunca";
  const min = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  return min < 1 ? "hace un momento" : min < 60 ? `hace ${min} min` : new Date(v).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" });
};

/**
 * Pestaña "Calidad y cuadre" de Reportes (Fase 21d): bandeja de trabajo con dos vistas — Calidad de datos y Cuadre
 * Profit ↔ Odoo — más revisar ahora y ocultar la sección al terminar. Respeta la empresa activa; en «Ambas» es consulta.
 */
export function CalidadCuadre({ onCargando }: { onCargando?: (v: boolean) => void }) {
  const [params, setParams] = useSearchParams();
  const vista: Grupo = params.get("vista") === "cuadre" ? "cuadre" : "calidad";
  const cambiarVista = (v: Grupo) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (v === "calidad") n.delete("vista"); else n.set("vista", v);
    ["problema", "cuadre", "revision"].forEach((k) => n.delete(k));   // los filtros de una vista no aplican en la otra
    return n;
  }, { replace: true });

  const { soloLectura, empresas, empresaActiva } = useEmpresa();
  const { can } = usePermissions();
  const puedeEditar = can("reportes", "editar");
  const { toast } = useToast();
  const { tareas, error, cargando, cargar, refrescarUna } = useTareas(vista);
  const responsables = useResponsables();
  const odooBase = useOdooBase();
  const { estado: seccion, cambiar: cambiarSeccion, leer: leerSeccion } = useSeccionCalidad();
  const [revisando, setRevisando] = useState(false);
  const [confirmarOcultar, setConfirmarOcultar] = useState(false);
  useEffect(() => { onCargando?.(cargando); }, [cargando, onCargando]);

  const empresaNombre = (id: string | null) => (id ? empresas.find((e) => e.id === id)?.nombre_corto ?? "—" : "Compartido");
  const cidOdoo = (id: string | null) => (id ? empresas.find((e) => e.id === id)?.odoo_company_id ?? null : null);

  const revisar = async () => {
    setRevisando(true);
    const { data, error: e } = await supabase.rpc("calidad_revisar");
    setRevisando(false);
    if (e) { toast({ title: "No se pudo revisar", description: e.message, variant: "destructive" }); return; }
    const r = data as { omitida?: boolean; nuevas?: number; cerradas?: number; reabiertas?: number };
    toast({ title: r.omitida ? "Ya se revisó hace menos de un minuto" : "Revisión hecha",
      description: r.omitida ? undefined : `${r.nuevas ?? 0} nuevas · ${r.cerradas ?? 0} cerradas · ${r.reabiertas ?? 0} reabiertas` });
    await Promise.all([cargar(), leerSeccion()]);
  };

  const ocultar = async (v: boolean) => {
    try {
      await cambiarSeccion(v);
      toast({ title: v ? "Sección oculta" : "Sección visible", description: v ? `Oculta en ${empresaActiva?.nombre_corto ?? "la empresa"}. Se vuelve a mostrar desde el ícono al final de las pestañas.` : undefined });
    } catch (e) { toast({ title: "No se pudo cambiar", description: (e as Error).message, variant: "destructive" }); }
    setConfirmarOcultar(false);
  };

  const pendientesGrupo = (tareas ?? []).filter((t) => t.estado === "pendiente").length;
  const oculta = !!seccion?.oculta;
  const infoOculta = empresaActiva ? seccion?.detalle?.[empresaActiva.id] : null;

  const cabecera = (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border border-border bg-muted p-0.5 text-[13px]" role="tablist" aria-label="Vista">
        {([["calidad", "Calidad de datos"], ["cuadre", "Cuadre Profit ↔ Odoo"]] as const).map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={vista === k} onClick={() => cambiarVista(k)}
            className={cn("rounded-sm px-2.5 py-1 font-medium", vista === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t}</button>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span title="Se revisa sola después de cada sincronización con Odoo (cada 15 min, lun–sáb) y de noche">Revisado {haceCuanto(seccion?.revisado ?? null)}</span>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={revisar} disabled={revisando}>
          {revisando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}Revisar ahora
        </Button>
        {puedeEditar && !soloLectura && (
          oculta
            ? <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => ocultar(false)}><Eye className="mr-1 h-3.5 w-3.5" />Volver a mostrar la sección</Button>
            : <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmarOcultar(true)}><EyeOff className="mr-1 h-3.5 w-3.5" />Ocultar sección</Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-w-0">
      {oculta && (
        <p className="mb-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Esta sección está oculta{infoOculta ? ` desde el ${new Date(infoOculta.at).toLocaleDateString("es-VE")} (${infoOculta.por})` : ""}: no aparece en las pestañas de Reportes.
          Las tareas se siguen revisando solas.
        </p>
      )}
      {error ? (
        <>{cabecera}<p className="rounded-lg border border-border bg-card px-3 py-6 text-center text-sm text-destructive">{error}</p></>
      ) : !tareas ? (
        <>{cabecera}<div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando la bandeja…</div></>
      ) : (
        <BandejaTareas key={vista} grupo={vista} tareas={tareas} responsables={responsables} puedeEditar={puedeEditar} soloLectura={soloLectura}
          odooBase={odooBase} cidOdoo={cidOdoo} empresaNombre={empresaNombre} recargar={cargar} refrescarUna={refrescarUna}
          cabecera={<>{cabecera}{vista === "cuadre" && <CuadreResumen tareas={tareas} />}</>} />
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {vista === "calidad"
          ? "Estado y ciudad del cliente se corrigen desde aquí y GUDS los escribe en Odoo; lo demás se corrige en Odoo (lo contable solo se señala, con enlace). Cada tarea se cierra sola cuando la sincronización trae el dato corregido."
          : "Revisión uno a uno: comenta y marca «explicado» lo que no requiere cambio; si hay un error, se corrige en Odoo y la tarea se cierra sola."}
      </p>

      <AlertDialog open={confirmarOcultar} onOpenChange={setConfirmarOcultar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Ocultar «Calidad y cuadre»?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendientesGrupo ? `Aún quedan ${pendientesGrupo} tareas pendientes en esta vista. ` : "No quedan tareas pendientes en esta vista. "}
              La pestaña deja de verse en Reportes de {empresaActiva?.nombre_corto ?? "esta empresa"} para todos; queda un ícono al final de las pestañas para volver a abrirla. Las tareas se siguen revisando solas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => ocultar(true)}>Ocultar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
