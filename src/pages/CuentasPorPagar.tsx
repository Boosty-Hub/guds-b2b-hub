import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { OdooBadge } from "@/components/OdooBadge";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { useColumnas } from "@/components/datos/columnas";

interface FacturaProv {
  id: string; numero: string; referencia: string | null; tipo: string; es_nota_debito: boolean; proveedor_id: string | null;
  fecha_emision: string | null; fecha_vencimiento: string | null; moneda: string; total: number; total_usd: number; saldo_usd: number;
  estado_pago: string; estado: string; proveedor?: { nombre: string } | null;
}
interface PagoProv {
  id: string; numero: string; tipo: string; monto: number; moneda: string; monto_moneda: number | null; estado: string; fecha: string | null;
  referencia: string | null; proveedor?: { nombre: string } | null; banco?: { nombre: string } | null;
}
interface OrdenCompra {
  id: string; numero: string; referencia_proveedor: string | null; fecha_orden: string | null; estado: string; estado_recepcion: string | null;
  estado_facturacion: string | null; moneda: string | null; total: number; total_usd: number; proveedor?: { nombre: string } | null;
}
interface RetEmitida {
  id: string; tipo: string; numero: string; fecha: string | null; periodo: string | null; porcentaje: number | null; base_imponible: number;
  total: number; estado: string; proveedor?: { nombre: string } | null;
}
interface Acreedor {
  proveedor_id: string; nombre: string; docs: number; saldo: number;
  porVencer: number; d30: number; d60: number; d90: number; mas90: number; aFavor: number; neto: number;
}
const TRAMOS = [
  { k: "porVencer", label: "Por vencer" }, { k: "d30", label: "1–30 días" }, { k: "d60", label: "31–60 días" },
  { k: "d90", label: "61–90 días" }, { k: "mas90", label: "+90 días" },
] as const;
const ESTADO_PAGO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" }, parcial: { label: "Parcial", variant: "outline" },
  pagado: { label: "Pagada", variant: "default" }, anulado: { label: "Anulada", variant: "destructive" },
};
const ESTADO_OC: Record<string, string> = {
  borrador: "Borrador", enviada: "Enviada", por_aprobar: "Por aprobar", confirmada: "Confirmada", bloqueada: "Bloqueada", cancelada: "Cancelada",
};
const RECEPCION: Record<string, string> = { pending: "Por recibir", partial: "Recepción parcial", full: "Recibida" };
const fmtFecha = (d?: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("es-VE") : "—");

const CuentasPorPagar = () => {
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [facturas, setFacturas] = useState<FacturaProv[]>([]);
  const [pagos, setPagos] = useState<PagoProv[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [retenciones, setRetenciones] = useState<RetEmitida[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const [f, p, o, r] = await Promise.all([
        supabase.from("facturas_proveedor").select("id, numero, referencia, tipo, es_nota_debito, proveedor_id, fecha_emision, fecha_vencimiento, moneda, total, total_usd, saldo_usd, estado_pago, estado, proveedor:proveedores(nombre)").order("fecha_emision", { ascending: false }),
        supabase.from("pagos_proveedor").select("id, numero, tipo, monto, moneda, monto_moneda, estado, fecha, referencia, proveedor:proveedores(nombre), banco:bancos(nombre)").order("fecha", { ascending: false }),
        supabase.from("ordenes_compra").select("id, numero, referencia_proveedor, fecha_orden, estado, estado_recepcion, estado_facturacion, moneda, total, total_usd, proveedor:proveedores(nombre)").order("fecha_orden", { ascending: false }),
        supabase.from("retenciones_emitidas").select("id, tipo, numero, fecha, periodo, porcentaje, base_imponible, total, estado, proveedor:proveedores(nombre)").order("fecha", { ascending: false }),
      ]);
      setFacturas((f.data as unknown as FacturaProv[]) ?? []);
      setPagos((p.data as unknown as PagoProv[]) ?? []);
      setOrdenes((o.data as unknown as OrdenCompra[]) ?? []);
      setRetenciones((r.data as unknown as RetEmitida[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const publicadas = useMemo(() => facturas.filter((f) => f.estado === "posted"), [facturas]);
  const acreedores = useMemo(() => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const m = new Map<string, Acreedor>();
    for (const f of publicadas) {
      const saldo = Number(f.saldo_usd);
      if (!f.proveedor_id || Math.abs(saldo) <= 0.009) continue;
      const a = m.get(f.proveedor_id) || { proveedor_id: f.proveedor_id, nombre: f.proveedor?.nombre || "—", docs: 0, saldo: 0,
        porVencer: 0, d30: 0, d60: 0, d90: 0, mas90: 0, aFavor: 0, neto: 0 };
      if (saldo < 0) a.aFavor += saldo;
      else {
        a.docs += 1; a.saldo += saldo;
        const vence = f.fecha_vencimiento || f.fecha_emision;
        const dias = vence ? Math.floor((hoy.getTime() - new Date(`${vence}T00:00:00`).getTime()) / 86400000) : 0;
        if (dias <= 0) a.porVencer += saldo; else if (dias <= 30) a.d30 += saldo; else if (dias <= 60) a.d60 += saldo;
        else if (dias <= 90) a.d90 += saldo; else a.mas90 += saldo;
      }
      a.neto = a.saldo + a.aFavor;
      m.set(f.proveedor_id, a);
    }
    return [...m.values()].filter((a) => a.saldo > 0.009).sort((x, y) => y.saldo - x.saldo);
  }, [publicadas]);

  const neto = publicadas.reduce((s, f) => s + Number(f.saldo_usd || 0), 0);
  const vencidoMas90 = acreedores.reduce((s, a) => s + a.mas90, 0);
  const totalesTramo = TRAMOS.map((t) => ({ ...t, monto: acreedores.reduce((s, a) => s + a[t.k], 0) }));
  const filtro = q.trim().toLowerCase();
  const coincide = (...v: (string | null | undefined)[]) => !filtro || v.some((x) => (x || "").toLowerCase().includes(filtro));

  const { ordenadas: acrOrdenados, orden: ordenAcr, alternar: alternarAcr } = useOrdenTabla(acreedores.filter((a) => coincide(a.nombre)), {
    nombre: (a) => a.nombre, docs: (a) => a.docs, porVencer: (a) => a.porVencer, d30: (a) => a.d30, d60: (a) => a.d60,
    d90: (a) => a.d90, mas90: (a) => a.mas90, saldo: (a) => a.saldo, aFavor: (a) => Math.abs(a.aFavor), neto: (a) => a.neto,
  });
  const pgAcr = usePagination(acrOrdenados, 50);
  const exportarAcreedores = () => exportarCSV("cuentas-por-pagar", acrOrdenados, [
    { titulo: "Proveedor", valor: (a) => a.nombre }, { titulo: "Facturas", valor: (a) => a.docs },
    ...TRAMOS.map((t) => ({ titulo: t.label, valor: (a: Acreedor) => Number(a[t.k].toFixed(2)) })),
    { titulo: "Saldo", valor: (a) => Number(a.saldo.toFixed(2)) }, { titulo: "A favor", valor: (a) => Number(Math.abs(a.aFavor).toFixed(2)) },
    { titulo: "Neto", valor: (a) => Number(a.neto.toFixed(2)) },
  ]);
  const [tabCxp, setTabCxp] = useState("pagar");
  const pgFac = usePagination(facturas.filter((f) => coincide(f.numero, f.referencia, f.proveedor?.nombre)), 50);
  const pgPag = usePagination(pagos.filter((p) => coincide(p.numero, p.referencia, p.proveedor?.nombre)), 50);
  const pgOc = usePagination(ordenes.filter((o) => coincide(o.numero, o.referencia_proveedor, o.proveedor?.nombre)), 50);
  const pgRet = usePagination(retenciones.filter((r) => coincide(r.numero, r.proveedor?.nombre)), 50);

  const cols = useColumnas("cxp-antiguedad", [{ etiqueta: "Proveedor", fija: true }, { etiqueta: "Facturas" }, ...["Por vencer", "1–30 días", "31–60 días", "61–90 días", "+90 días"].map((etiqueta) => ({ etiqueta })), { etiqueta: "Saldo" }, { etiqueta: "A favor" }, { etiqueta: "Neto" }]);
  return (
    <MainLayout title="Cuentas por Pagar">
      {cols.estilo}
      <KpiStrip items={[
        { label: "Por pagar (neto)", valor: formatPrice(neto), tono: "negativo" },
        { label: "Proveedores con saldo", valor: acreedores.length },
        { label: "Vencido +90 días", valor: formatPrice(vencidoMas90), tono: "alerta" },
        { label: "Retenciones emitidas", valor: retenciones.length },
      ]} />

      {/* Pestañas, búsqueda y nota de origen en una sola fila */}
      <Tabs value={tabCxp} onValueChange={setTabCxp}>
        <BarraLista
          pestanas={
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="pagar">Por pagar ({acreedores.length})</TabsTrigger>
              <TabsTrigger value="facturas">Facturas de proveedor ({facturas.length})</TabsTrigger>
              <TabsTrigger value="pagos">Pagos ({pagos.length})</TabsTrigger>
              <TabsTrigger value="ordenes">Órdenes de compra ({ordenes.length})</TabsTrigger>
              <TabsTrigger value="retenciones">Retenciones emitidas ({retenciones.length})</TabsTrigger>
            </TabsList>
          }
          busqueda={q}
          onBusqueda={setQ}
          placeholder="Buscar proveedor o documento..."
          acciones={<>
            <span className="hidden items-center gap-1.5 text-xs text-muted-foreground 2xl:flex" title="Compras y cuentas por pagar sincronizadas desde Odoo"><OdooBadge /> Sincronizado desde Odoo</span>
            {tabCxp === "pagar" && <>{cols.selector}<BotonExportar soloIcono onClick={exportarAcreedores} total={acrOrdenados.length} /></>}
          </>}
        />

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <>

          <TabsContent value="pagar">
            <KpiStrip
              className="mb-2"
              items={totalesTramo.map((t) => ({
                label: t.label,
                valor: formatPrice(t.monto),
                tono: t.k === "mas90" && t.monto > 0.009 ? "negativo" as const : undefined,
              }))}
            />
            <div className="rounded-lg border border-border bg-card">
              <Table data-tabla="cxp-antiguedad">
                <TableHeader>
                  <TableRow>
                    <EncabezadoOrdenable clave="nombre" orden={ordenAcr} onOrdenar={alternarAcr}>Proveedor</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="docs" orden={ordenAcr} onOrdenar={alternarAcr} alinear="centro">Facturas</EncabezadoOrdenable>
                    {TRAMOS.map((t) => <EncabezadoOrdenable key={t.k} clave={t.k} orden={ordenAcr} onOrdenar={alternarAcr} alinear="derecha" className="hidden lg:table-cell">{t.label}</EncabezadoOrdenable>)}
                    <EncabezadoOrdenable clave="saldo" orden={ordenAcr} onOrdenar={alternarAcr} alinear="derecha">Saldo</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="aFavor" orden={ordenAcr} onOrdenar={alternarAcr} alinear="derecha">A favor</EncabezadoOrdenable>
                    <EncabezadoOrdenable clave="neto" orden={ordenAcr} onOrdenar={alternarAcr} alinear="derecha">Neto</EncabezadoOrdenable>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pgAcr.pageItems.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="py-10 text-center text-muted-foreground">No hay saldos por pagar</TableCell></TableRow>
                  ) : pgAcr.pageItems.map((a) => (
                    <TableRow key={a.proveedor_id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/proveedores/${a.proveedor_id}`)}>
                      <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={a.nombre}>{a.nombre}</span></TableCell>
                      <TableCell className="text-center">{a.docs}</TableCell>
                      {TRAMOS.map((t) => (
                        <TableCell key={t.k} className={`hidden whitespace-nowrap text-right lg:table-cell ${a[t.k] > 0.009 ? (t.k === "mas90" ? "text-destructive" : "") : "text-muted-foreground"}`}>
                          {a[t.k] > 0.009 ? formatPrice(a[t.k]) : "—"}
                        </TableCell>
                      ))}
                      <TableCell className="whitespace-nowrap text-right font-semibold text-destructive">{formatPrice(a.saldo)}</TableCell>
                      <TableCell className={`whitespace-nowrap text-right ${a.aFavor < -0.009 ? "text-success" : "text-muted-foreground"}`}>{a.aFavor < -0.009 ? formatPrice(Math.abs(a.aFavor)) : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(a.neto)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <DataTablePagination pagination={pgAcr} />
            </div>
          </TabsContent>

          <TabsContent value="facturas">
            <div className="rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº</TableHead><TableHead>Proveedor</TableHead><TableHead>Emisión</TableHead><TableHead>Vence</TableHead>
                    <TableHead className="text-right">Total (USD)</TableHead><TableHead className="text-right">Saldo (USD)</TableHead><TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pgFac.pageItems.map((f) => (
                    <TableRow key={f.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/facturas-proveedor/${f.id}`)}>
                      <TableCell className="font-mono text-xs text-primary">
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          {f.numero}
                          {f.tipo === "nota_credito" && <Badge variant="outline" className="px-1 py-0 font-sans text-[10px]">NC</Badge>}
                          {f.es_nota_debito && <Badge variant="outline" className="px-1 py-0 font-sans text-[10px]">ND</Badge>}
                          {f.referencia && <span className="max-w-[160px] truncate font-sans text-xs text-muted-foreground" title={`Ref. ${f.referencia}`}>Ref. {f.referencia}</span>}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={f.proveedor?.nombre || undefined}>{f.proveedor?.nombre || "—"}</span></TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtFecha(f.fecha_emision)}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtFecha(f.fecha_vencimiento)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{formatPrice(f.total_usd)}</TableCell>
                      <TableCell className={`whitespace-nowrap text-right font-semibold ${Number(f.saldo_usd) > 0.009 ? "text-destructive" : ""}`}>{formatPrice(f.saldo_usd)}</TableCell>
                      <TableCell className="whitespace-nowrap"><Badge variant={ESTADO_PAGO[f.estado_pago]?.variant ?? "secondary"}>{ESTADO_PAGO[f.estado_pago]?.label ?? f.estado_pago}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <DataTablePagination pagination={pgFac} />
            </div>
          </TabsContent>

          <TabsContent value="pagos">
            <div className="rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº</TableHead><TableHead>Tipo</TableHead><TableHead>Proveedor</TableHead><TableHead>Banco</TableHead><TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Monto (USD)</TableHead><TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pgPag.pageItems.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{p.numero}</TableCell>
                      <TableCell><Badge variant="outline">{p.tipo === "pago" ? "Pago" : "Reintegro"}</Badge></TableCell>
                      <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={p.proveedor?.nombre || undefined}>{p.proveedor?.nombre || "—"}</span></TableCell>
                      <TableCell className="text-muted-foreground"><span className="block max-w-[180px] truncate" title={p.banco?.nombre || undefined}>{p.banco?.nombre || "—"}</span></TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtFecha(p.fecha)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(p.monto)}</TableCell>
                      <TableCell><Badge variant={p.estado === "verificado" ? "default" : p.estado === "pendiente" ? "secondary" : "destructive"}>{p.estado}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <DataTablePagination pagination={pgPag} />
            </div>
          </TabsContent>

          <TabsContent value="ordenes">
            <div className="rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº</TableHead><TableHead>Proveedor</TableHead><TableHead>Fecha</TableHead><TableHead>Estado</TableHead><TableHead>Recepción</TableHead>
                    <TableHead className="text-right">Total (USD)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pgOc.pageItems.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Sin órdenes de compra</TableCell></TableRow>
                  ) : pgOc.pageItems.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs text-primary">
                        <span className="flex items-center gap-1.5 whitespace-nowrap">
                          {o.numero}
                          {o.referencia_proveedor && <span className="max-w-[160px] truncate font-sans text-xs text-muted-foreground" title={`Ref. ${o.referencia_proveedor}`}>Ref. {o.referencia_proveedor}</span>}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={o.proveedor?.nombre || undefined}>{o.proveedor?.nombre || "—"}</span></TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtFecha(o.fecha_orden)}</TableCell>
                      <TableCell className="whitespace-nowrap"><Badge variant={o.estado === "cancelada" ? "destructive" : o.estado === "confirmada" || o.estado === "bloqueada" ? "default" : "secondary"}>{ESTADO_OC[o.estado] ?? o.estado}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{o.estado_recepcion ? RECEPCION[o.estado_recepcion] ?? o.estado_recepcion : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(o.total_usd)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <DataTablePagination pagination={pgOc} />
            </div>
          </TabsContent>

          <TabsContent value="retenciones">
            <div className="rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Comprobante</TableHead><TableHead>Tipo</TableHead><TableHead>Proveedor</TableHead><TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Base</TableHead><TableHead className="text-right">Retenido (USD)</TableHead><TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pgRet.pageItems.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{r.numero}</TableCell>
                      <TableCell className="whitespace-nowrap uppercase text-muted-foreground">{r.tipo}{r.porcentaje ? ` · ${r.porcentaje}%` : ""}</TableCell>
                      <TableCell className="font-medium"><span className="block max-w-[260px] truncate" title={r.proveedor?.nombre || undefined}>{r.proveedor?.nombre || "—"}</span></TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtFecha(r.fecha)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">{formatPrice(r.base_imponible)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(r.total)}</TableCell>
                      <TableCell><Badge variant={r.estado === "confirmado" ? "default" : r.estado === "anulado" ? "destructive" : "secondary"}>{r.estado}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <DataTablePagination pagination={pgRet} />
            </div>
          </TabsContent>
        </>
      )}
      </Tabs>
    </MainLayout>
  );
};

export default CuentasPorPagar;
