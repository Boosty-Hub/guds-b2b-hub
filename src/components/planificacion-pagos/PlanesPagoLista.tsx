import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { cn } from "@/lib/utils";
import { ESTADO_PLAN, type EstadoPlan, type PlanPago, fmtFecha, fmtUsd, nombrePersona } from "./comun";

export const SELECT_PLAN_LISTA = "id, empresa_id, numero, estado, fecha_corte, fecha_pago, notas, aprobado_at, cerrado_at, cierre, created_at, updated_at, "
  + "creado:usuarios!planes_pago_creado_por_fkey(nombre, apellido), aprobado:usuarios!planes_pago_aprobado_por_fkey(nombre, apellido), "
  + "items:planes_pago_items(monto_usd, monto_pagado_usd, estado, proveedor_id)";

export interface ResumenPlan { facturas: number; proveedores: number; planificado: number; pagado: number; diferencias: number; pagados: number }
export const resumirPlan = (p: PlanPago): ResumenPlan => {
  const it = p.items ?? [];
  return {
    facturas: it.length, proveedores: new Set(it.map((i) => i.proveedor_id)).size,
    planificado: it.reduce((s, i) => s + Number(i.monto_usd), 0), pagado: it.reduce((s, i) => s + Number(i.monto_pagado_usd), 0),
    diferencias: it.filter((i) => i.estado === "diferencia").length, pagados: it.filter((i) => i.estado === "pagado" || i.estado === "diferencia").length,
  };
};

/** Historial de planes de pago (pestaña "Planes de pago" de Cuentas por Pagar). */
export function PlanesPagoLista({ q, estado, empresa, onConteo }: {
  q: string; estado: string | null; empresa: string | null; onConteo?: (n: number, total: number) => void;
}) {
  const navigate = useNavigate();
  const { soloLectura, empresas } = useEmpresa();
  const [planes, setPlanes] = useState<PlanPago[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    (async () => {
      setCargando(true);
      const { data, error: e } = await supabase.from("planes_pago").select(SELECT_PLAN_LISTA).order("created_at", { ascending: false });
      setError(e ? e.message : null);
      setPlanes((data ?? []) as unknown as PlanPago[]);
      setCargando(false);
    })();
  }, [version]);

  const filtro = q.trim().toLowerCase();
  const filas = useMemo(() => planes.filter((p) => (!estado || p.estado === estado) && (!empresa || p.empresa_id === empresa)
    && (!filtro || [p.numero, p.notas, nombrePersona(p.creado)].some((x) => (x || "").toLowerCase().includes(filtro)))), [planes, estado, empresa, filtro]);
  useEffect(() => { onConteo?.(filas.length, planes.length); }, [filas.length, planes.length, onConteo]);
  const pg = usePagination(filas, 50, `${estado}|${empresa}|${filtro}`);
  const nombreEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nombre_corto ?? "—";

  if (cargando) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-card px-4 py-6 text-center text-sm" data-error-carga="">
        <p className="text-destructive">No se pudieron cargar los planes de pago ({error}).</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setVersion((v) => v + 1)}>Reintentar</Button>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-card">
      <Table data-tabla="planes-pago">
        <TableHeader>
          <TableRow>
            <TableHead>Plan</TableHead>
            {soloLectura && <TableHead>Empresa</TableHead>}
            <TableHead>Pago</TableHead>
            <TableHead className="hidden md:table-cell">Corte</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="hidden text-center sm:table-cell">Facturas</TableHead>
            <TableHead className="text-right">Planificado</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Pagado (Odoo)</TableHead>
            <TableHead className="hidden lg:table-cell">Creado por</TableHead>
            <TableHead className="hidden lg:table-cell">Aprobado por</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pg.pageItems.length === 0 ? (
            <TableRow><TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
              {planes.length ? "Ningún plan con estos filtros" : "Aún no hay planes de pago. Créalos desde la pestaña Planificación."}
            </TableCell></TableRow>
          ) : pg.pageItems.map((p) => {
            const r = resumirPlan(p);
            const e = ESTADO_PLAN[p.estado as EstadoPlan];
            return (
              <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/planes-pago/${p.id}`)} data-plan={p.id}>
                <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{p.numero}</TableCell>
                {soloLectura && <TableCell className="whitespace-nowrap text-muted-foreground">{nombreEmpresa(p.empresa_id)}</TableCell>}
                <TableCell className="whitespace-nowrap">{fmtFecha(p.fecha_pago)}</TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{fmtFecha(p.fecha_corte)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant={e?.variant ?? "secondary"} className={e?.clase}>{e?.label ?? p.estado}</Badge>
                  {r.diferencias > 0 && <Badge variant="outline" className="ml-1 border-destructive px-1 py-0 text-[10px] text-destructive">{r.diferencias} dif.</Badge>}
                </TableCell>
                <TableCell className="hidden text-center sm:table-cell">{r.facturas}</TableCell>
                <TableCell className="whitespace-nowrap text-right font-semibold">{fmtUsd(r.planificado)}</TableCell>
                <TableCell className={cn("hidden whitespace-nowrap text-right sm:table-cell", r.pagado > 0.009 ? "text-success" : "text-muted-foreground")}>
                  {r.pagado > 0.009 ? fmtUsd(r.pagado) : "—"}
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{nombrePersona(p.creado)}</TableCell>
                <TableCell className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{p.aprobado ? nombrePersona(p.aprobado) : "—"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <DataTablePagination pagination={pg} />
    </div>
  );
}
