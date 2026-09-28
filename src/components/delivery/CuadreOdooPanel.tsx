import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarraLista } from "@/components/datos/BarraLista";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { usePagination } from "@/hooks/use-pagination";
import { ExternalLink, Info, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { OdooBadge } from "@/components/OdooBadge";
import { EmpresaDistintivo } from "@/components/EmpresaSelector";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { EstadoTransferencia } from "@/components/inventario/EstadoTransferencia";
import { fechaHora } from "@/components/delivery/fechas";
import { ESTADO_ENTREGA, fmtCantidad } from "@/components/delivery/entregas";
import { DISCREPANCIAS, SEL_CUADRE, TIPO_CUADRE, enlaceOdooPicking, type FilaCuadre, type TipoCuadre } from "@/components/delivery/seguimiento";

type Filtro = "discrepancias" | "pendiente_odoo" | "cuadrada" | "todas";

/** Cuadre con Odoo (D8, solo lectura): en cada sincronización se compara lo cerrado en GUDS con el documento de entrega en
 *  Odoo. Muestra las diferencias con el enlace al documento en Odoo para corregirlo allá. GUDS no escribe nada en Odoo. */
export function CuadreOdooPanel({ onVerEntrega }: { onVerEntrega?: (transferenciaOdooId: number) => void }) {
  const { toast } = useToast();
  const { soloLectura, empresas } = useEmpresa();
  const [filas, setFilas] = useState<FilaCuadre[]>([]);
  const [cargando, setCargando] = useState(true);
  const [base, setBase] = useState<string | null>(null);
  const [modo, setModo] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("discrepancias");
  const [q, setQ] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    const [c, cfg] = await Promise.all([
      supabase.from("cuadre_entregas_odoo").select(SEL_CUADRE).order("detectado_at", { ascending: false }).limit(2000),
      supabase.from("configuracion").select("clave, valor").in("clave", ["odoo_url_web", "odoo_escritura_entregas"]),
    ]);
    if (c.error) toast({ title: "No se pudo cargar el cuadre con Odoo", description: c.error.message, variant: "destructive" });
    setFilas((c.data as unknown as FilaCuadre[] | null) ?? []);
    const conf = new Map(((cfg.data as { clave: string; valor: string | null }[] | null) ?? []).map((x) => [x.clave, x.valor]));
    setBase(conf.get("odoo_url_web") || null);
    setModo(conf.get("odoo_escritura_entregas") ?? null);
    setCargando(false);
  }, [toast]);
  useEffect(() => { cargar(); }, [cargar]);

  const cuenta = (t: TipoCuadre) => filas.filter((f) => f.tipo === t).length;
  const disc = filas.filter((f) => DISCREPANCIAS.includes(f.tipo)).length;
  const vista = useMemo(() => {
    const t = q.trim().toLowerCase();
    return filas.filter((f) => (filtro === "todas" || (filtro === "discrepancias" ? DISCREPANCIAS.includes(f.tipo) : f.tipo === filtro))
      && (!t || [f.doc_numero, f.entrega?.cliente?.nombre_negocio, f.entrega?.repartidor?.nombre].some((v) => (v || "").toLowerCase().includes(t))))
      .sort((a, b) => DISCREPANCIAS.indexOf(a.tipo) - DISCREPANCIAS.indexOf(b.tipo) || b.detectado_at.localeCompare(a.detectado_at));
  }, [filas, filtro, q]);
  const pag = usePagination(vista, 50);
  const revisado = filas.reduce<string | null>((m, f) => (!m || f.revisado_at > m ? f.revisado_at : m), null);
  const empresaDe = (id: string) => empresas.find((e) => e.id === id) ?? null;

  const estadoGuds = (f: FilaCuadre) => {
    if (!f.estado_guds) return <span className="text-muted-foreground">—</span>;
    const e = ESTADO_ENTREGA[f.estado_guds];
    return (
      <span className="flex flex-col items-start gap-0.5">
        <Badge variant="outline" className={`whitespace-nowrap font-normal ${e?.cls ?? ""}`}>{f.origen_cierre === "odoo" ? "Actualizado desde Odoo" : e?.label ?? f.estado_guds}</Badge>
        <span className="text-[11px] text-muted-foreground">
          {f.entrega?.repartidor ? `${f.entrega.repartidor.nombre} ${f.entrega.repartidor.apellido ?? ""}`.trim() : ""}{f.cerrada_guds_at ? ` · ${fechaHora(f.cerrada_guds_at)}` : ""}
        </span>
      </span>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-md border border-sky-300/60 bg-sky-50 px-3 py-2 text-xs text-sky-950 dark:bg-sky-500/10 dark:text-sky-100">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Solo lectura: en cada sincronización con Odoo se compara el cierre de cada entrega en GUDS con su documento en Odoo. Las diferencias se corrigen en Odoo
          (el enlace abre el documento).{" "}
          {modo === "simular" || !modo
            ? <>La escritura de entregas en Odoo está en <b>modo simulación</b>: que una entrega figure «Cerrada en GUDS · Odoo abierta» es lo normal hasta el piloto.</>
            : <>La escritura de entregas en Odoo está <b>activa</b>: lo cerrado en GUDS debería quedar validado en Odoo en minutos.</>}
          {revisado && <span className="block text-sky-900/80 dark:text-sky-100/80">Última revisión: {fechaHora(revisado)}.</span>}
        </p>
      </div>

      <Tabs value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
        <BarraLista
          pestanas={(
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="discrepancias">Con diferencias ({disc})</TabsTrigger>
              <TabsTrigger value="pendiente_odoo">Odoo aún abierta ({cuenta("pendiente_odoo")})</TabsTrigger>
              <TabsTrigger value="cuadrada">Cuadradas ({cuenta("cuadrada")})</TabsTrigger>
              <TabsTrigger value="todas">Todas ({filas.length})</TabsTrigger>
            </TabsList>
          )}
          busqueda={q} onBusqueda={setQ} placeholder="Buscar documento, cliente…"
          contador={cargando ? undefined : `${vista.length} documentos`}
          acciones={<Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-xs" onClick={cargar} disabled={cargando}><RefreshCw className={`h-3.5 w-3.5 ${cargando ? "animate-spin" : ""}`} />Actualizar</Button>}
        />
      </Tabs>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {cargando && !filas.length ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        : vista.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {filtro === "discrepancias" ? "Sin diferencias: lo cerrado en GUDS coincide con Odoo (o Odoo aún no lo validó)." : "No hay documentos con este filtro."}
          </div>
        ) : (
          <Table data-tabla="cuadre">
            <TableHeader><TableRow>
              <TableHead>Documento</TableHead><TableHead>Cuadre</TableHead><TableHead>En GUDS</TableHead><TableHead>En Odoo</TableHead>
              <TableHead>Diferencias por producto</TableHead><TableHead>Desde</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pag.pageItems.map((f) => {
                const t = TIPO_CUADRE[f.tipo];
                const url = enlaceOdooPicking(base, f.transferencia_odoo_id);
                return (
                  <TableRow key={f.transferencia_odoo_id} data-cuadre={f.tipo}>
                    <TableCell className="whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        {soloLectura && <EmpresaDistintivo empresa={empresaDe(f.empresa_id)} className="h-4 w-4 text-[8px]" />}
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline" title="Abrir el documento en Odoo">
                            {f.doc_numero ?? f.transferencia_odoo_id}<ExternalLink className="h-3 w-3" />
                          </a>
                        ) : <span className="font-mono text-xs">{f.doc_numero ?? f.transferencia_odoo_id}</span>}
                      </span>
                      <span className="block max-w-[200px] truncate text-[11px] text-muted-foreground" title={f.entrega?.cliente?.nombre_negocio}>{f.entrega?.cliente?.nombre_negocio ?? ""}</span>
                      {onVerEntrega && <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => onVerEntrega(f.transferencia_odoo_id)}>Ver en GUDS</button>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`whitespace-nowrap font-normal ${t.cls}`} title={t.ayuda}>{t.corto}</Badge>
                    </TableCell>
                    <TableCell>{estadoGuds(f)}</TableCell>
                    <TableCell>
                      <span className="flex flex-col items-start gap-0.5">
                        {f.estado_odoo === "no_existe" ? <Badge variant="outline" className="font-normal text-muted-foreground">Ya no existe</Badge> : f.estado_odoo ? <EstadoTransferencia estado={f.estado_odoo} /> : "—"}
                        {f.validada_odoo_at && <span className="text-[11px] text-muted-foreground">{fechaHora(f.validada_odoo_at)}</span>}
                      </span>
                    </TableCell>
                    <TableCell className="min-w-[200px] text-xs">
                      {f.lineas?.length ? (
                        <ul className="space-y-0.5">
                          {f.lineas.slice(0, 4).map((l, k) => (
                            <li key={k} className="truncate" title={l.producto ?? ""}>
                              {l.producto ?? "Producto"}: <span className="tabular-nums">GUDS {fmtCantidad(l.guds)} · Odoo {fmtCantidad(l.odoo)}</span>
                              <span className={`ml-1 tabular-nums ${l.diferencia < 0 ? "text-destructive" : "text-warning"}`}>({l.diferencia > 0 ? "+" : ""}{fmtCantidad(l.diferencia)})</span>
                            </li>
                          ))}
                          {f.lineas.length > 4 && <li className="text-muted-foreground">y {f.lineas.length - 4} más</li>}
                        </ul>
                      ) : <span className="text-muted-foreground">{f.tipo === "cuadrada" ? "Mismas cantidades" : "—"}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">{fechaHora(f.detectado_at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {vista.length > 0 && <DataTablePagination pagination={pag} />}
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <OdooBadge titulo="Documentos de entrega de Odoo: se corrigen en Odoo" />
        Diferencia = Odoo − GUDS. «Validada sin GUDS»: Odoo la validó y en GUDS el repartidor no la cerró como entregada (la oficina la validó, o GUDS la tiene rechazada,
        reprogramada o anulada).
      </p>
    </div>
  );
}
