import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, Truck, Mail, Phone, MapPin } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { OdooBadge } from "@/components/OdooBadge";

interface Proveedor {
  id: string; odoo_id: number | null; odoo_sync_at: string | null; codigo: string; nombre: string; rif: string | null;
  email: string | null; telefono: string | null; celular: string | null; direccion: string | null; ciudad: string | null; estado: string | null;
  es_empresa: boolean | null; condicion_pago: string | null; dias_credito: number | null; activo: boolean; cliente_id: string | null;
}
interface FacturaProv {
  id: string; numero: string; referencia: string | null; tipo: string; es_nota_debito: boolean; fecha_emision: string | null;
  fecha_vencimiento: string | null; total_usd: number; saldo_usd: number; estado_pago: string; estado: string;
}
interface PagoProv { id: string; numero: string; tipo: string; monto: number; moneda: string; monto_moneda: number | null; estado: string; fecha: string | null; banco?: { nombre: string } | null; }
interface OrdenCompra { id: string; numero: string; referencia_proveedor: string | null; fecha_orden: string | null; estado: string; estado_recepcion: string | null; total_usd: number; }
interface RetEmitida { id: string; tipo: string; numero: string; fecha: string | null; porcentaje: number | null; base_imponible: number; total: number; estado: string; }

const ESTADO_PAGO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" }, parcial: { label: "Parcial", variant: "outline" },
  pagado: { label: "Pagada", variant: "default" }, anulado: { label: "Anulada", variant: "destructive" },
};
const ESTADO_OC: Record<string, string> = {
  borrador: "Borrador", enviada: "Enviada", por_aprobar: "Por aprobar", confirmada: "Confirmada", bloqueada: "Bloqueada", cancelada: "Cancelada",
};
const RECEPCION: Record<string, string> = { pending: "Por recibir", partial: "Recepción parcial", full: "Recibida" };
const fmtFecha = (d?: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("es-VE") : "—");

const ProveedorDetalle = () => {
  const { proveedorId } = useParams();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [prov, setProv] = useState<Proveedor | null>(null);
  const [facturas, setFacturas] = useState<FacturaProv[]>([]);
  const [pagos, setPagos] = useState<PagoProv[]>([]);
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [retenciones, setRetenciones] = useState<RetEmitida[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      const [{ data: p }, { data: f }, { data: pg }, { data: oc }, { data: r }] = await Promise.all([
        supabase.from("proveedores").select("*").eq("id", proveedorId).maybeSingle(),
        supabase.from("facturas_proveedor").select("id, numero, referencia, tipo, es_nota_debito, fecha_emision, fecha_vencimiento, total_usd, saldo_usd, estado_pago, estado").eq("proveedor_id", proveedorId).order("fecha_emision", { ascending: false }),
        supabase.from("pagos_proveedor").select("id, numero, tipo, monto, moneda, monto_moneda, estado, fecha, banco:bancos(nombre)").eq("proveedor_id", proveedorId).order("fecha", { ascending: false }),
        supabase.from("ordenes_compra").select("id, numero, referencia_proveedor, fecha_orden, estado, estado_recepcion, total_usd").eq("proveedor_id", proveedorId).order("fecha_orden", { ascending: false }),
        supabase.from("retenciones_emitidas").select("id, tipo, numero, fecha, porcentaje, base_imponible, total, estado").eq("proveedor_id", proveedorId).order("fecha", { ascending: false }),
      ]);
      if (activo) {
        setProv((p as Proveedor) ?? null);
        setFacturas((f as FacturaProv[]) ?? []);
        setPagos((pg as unknown as PagoProv[]) ?? []);
        setOrdenes((oc as OrdenCompra[]) ?? []);
        setRetenciones((r as RetEmitida[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [proveedorId]);

  const publicadas = useMemo(() => facturas.filter((f) => f.estado === "posted"), [facturas]);
  const abiertas = useMemo(() => publicadas.filter((f) => Math.abs(Number(f.saldo_usd)) > 0.009)
    .sort((a, b) => (a.fecha_vencimiento || a.fecha_emision || "").localeCompare(b.fecha_vencimiento || b.fecha_emision || "")), [publicadas]);
  const porPagar = abiertas.filter((f) => Number(f.saldo_usd) > 0).reduce((s, f) => s + Number(f.saldo_usd), 0);
  const aFavor = abiertas.filter((f) => Number(f.saldo_usd) < 0).reduce((s, f) => s + Number(f.saldo_usd), 0);
  const comprado = publicadas.reduce((s, f) => s + Number(f.total_usd || 0), 0);
  const pagado = pagos.filter((p) => p.tipo === "pago" && p.estado === "verificado").reduce((s, p) => s + Number(p.monto || 0), 0);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const diasVencida = (f: FacturaProv) => {
    const v = f.fecha_vencimiento || f.fecha_emision;
    return v ? Math.floor((hoy.getTime() - new Date(`${v}T00:00:00`).getTime()) / 86400000) : 0;
  };

  const pgFac = usePagination(facturas, 50);
  const pgPag = usePagination(pagos, 50);
  const pgOc = usePagination(ordenes, 50);
  const pgRet = usePagination(retenciones, 50);

  const volver = (
    <Button variant="ghost" size="sm" className="mb-2 h-7 gap-1.5 px-2 text-xs" onClick={() => navigate(-1)}>
      <ArrowLeft className="h-3.5 w-3.5" /> Volver
    </Button>
  );
  if (loading) {
    return <MainLayout title="Proveedor">{volver}<div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></MainLayout>;
  }
  if (!prov) {
    return (
      <MainLayout title="Proveedor">
        {volver}
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground"><Truck className="mb-4 h-12 w-12 opacity-50" /><p>Proveedor no encontrado</p></div>
      </MainLayout>
    );
  }

  const facturaLink = (f: FacturaProv) => (
    <span className="flex items-center gap-1.5">
      <Link to={`/admin/facturas-proveedor/${f.id}`} className="text-primary hover:underline">{f.numero}</Link>
      {f.tipo === "nota_credito" && <Badge variant="outline" className="px-1 py-0 font-sans text-[10px]">NC</Badge>}
      {f.es_nota_debito && <Badge variant="outline" className="px-1 py-0 font-sans text-[10px]">ND</Badge>}
    </span>
  );

  return (
    <MainLayout title={prov.nombre}>
      {volver}

      <div className="mb-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-semibold">{prov.nombre}</h1>
              {prov.odoo_id && <OdooBadge sincronizado={prov.odoo_sync_at} />}
              {!prov.activo && <Badge variant="secondary">Archivado</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {prov.codigo}{prov.rif ? ` · ${prov.rif}` : ""} · {prov.es_empresa ? "Empresa" : "Persona natural"}
              {prov.condicion_pago ? ` · ${prov.condicion_pago}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {prov.email && <span className="flex items-center gap-1.5"><Mail className="h-4 w-4" />{prov.email}</span>}
              {(prov.telefono || prov.celular) && <span className="flex items-center gap-1.5"><Phone className="h-4 w-4" />{[prov.telefono, prov.celular].filter(Boolean).join(" · ")}</span>}
              {(prov.direccion || prov.ciudad) && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{[prov.direccion, prov.ciudad, prov.estado].filter(Boolean).join(", ")}</span>}
            </div>
            {prov.cliente_id && (
              <p className="mt-2 text-sm">También es cliente · <Link to={`/admin/clientes/${prov.cliente_id}`} className="font-medium text-primary underline">ver ficha de cliente</Link></p>
            )}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4 border-t border-border pt-3 lg:grid-cols-5">
          <div><p className="text-xs text-muted-foreground">Por pagar</p><p className={`text-lg font-bold ${porPagar > 0.009 ? "text-destructive" : ""}`}>{formatPrice(porPagar)}</p></div>
          <div><p className="text-xs text-muted-foreground">A favor (NC / anticipos)</p><p className="text-base font-semibold text-success">{formatPrice(Math.abs(aFavor))}</p></div>
          <div><p className="text-xs text-muted-foreground">Neto</p><p className="text-base font-semibold">{formatPrice(porPagar + aFavor)}</p></div>
          <div><p className="text-xs text-muted-foreground">Comprado (neto facturado)</p><p className="text-lg font-semibold">{formatPrice(comprado)}</p></div>
          <div><p className="text-xs text-muted-foreground">Pagado</p><p className="text-lg font-semibold">{formatPrice(pagado)}</p></div>
        </div>
      </div>

      <Tabs defaultValue="cuenta">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="cuenta">Estado de cuenta ({abiertas.length})</TabsTrigger>
          <TabsTrigger value="facturas">Facturas ({facturas.length})</TabsTrigger>
          <TabsTrigger value="pagos">Pagos ({pagos.length})</TabsTrigger>
          <TabsTrigger value="ordenes">Órdenes de compra ({ordenes.length})</TabsTrigger>
          <TabsTrigger value="retenciones">Retenciones ({retenciones.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="cuenta" className="mt-4">
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead><TableHead>Ref. proveedor</TableHead><TableHead>Emisión</TableHead><TableHead>Vence</TableHead>
                  <TableHead className="text-right">Total (USD)</TableHead><TableHead className="text-right">Saldo (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {abiertas.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Sin documentos abiertos: la cuenta está al día</TableCell></TableRow>
                ) : abiertas.map((f) => {
                  const dias = diasVencida(f);
                  const saldo = Number(f.saldo_usd);
                  return (
                    <TableRow key={f.id}>
                      <TableCell className="font-mono text-sm">{facturaLink(f)}</TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">{f.referencia || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtFecha(f.fecha_emision)}</TableCell>
                      <TableCell className={saldo > 0 && dias > 0 ? (dias > 90 ? "text-destructive" : "text-warning") : "text-muted-foreground"}>
                        {fmtFecha(f.fecha_vencimiento)}{saldo > 0 && dias > 0 && <span className="block text-xs">{dias} días vencida</span>}
                      </TableCell>
                      <TableCell className="text-right">{formatPrice(f.total_usd)}</TableCell>
                      <TableCell className={`text-right font-semibold ${saldo > 0 ? "text-destructive" : "text-success"}`}>{formatPrice(saldo)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="facturas" className="mt-4">
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead><TableHead>Ref. proveedor</TableHead><TableHead>Emisión</TableHead>
                  <TableHead className="text-right">Total (USD)</TableHead><TableHead className="text-right">Saldo (USD)</TableHead><TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pgFac.pageItems.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Sin facturas</TableCell></TableRow>
                ) : pgFac.pageItems.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-sm">{facturaLink(f)}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{f.referencia || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtFecha(f.fecha_emision)}</TableCell>
                    <TableCell className="text-right">{formatPrice(f.total_usd)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatPrice(f.saldo_usd)}</TableCell>
                    <TableCell><Badge variant={ESTADO_PAGO[f.estado_pago]?.variant ?? "secondary"}>{ESTADO_PAGO[f.estado_pago]?.label ?? f.estado_pago}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pgFac} />
          </div>
        </TabsContent>

        <TabsContent value="pagos" className="mt-4">
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Nº</TableHead><TableHead>Tipo</TableHead><TableHead>Banco</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Monto (USD)</TableHead><TableHead>Estado</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {pgPag.pageItems.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Sin pagos</TableCell></TableRow>
                ) : pgPag.pageItems.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm text-primary">{p.numero}</TableCell>
                    <TableCell><Badge variant="outline">{p.tipo === "pago" ? "Pago" : "Reintegro"}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{p.banco?.nombre || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtFecha(p.fecha)}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {formatPrice(p.monto)}
                      {p.moneda === "BS" && p.monto_moneda != null && <span className="block text-xs font-normal text-muted-foreground">Bs. {Number(p.monto_moneda).toLocaleString("es-VE", { minimumFractionDigits: 2 })}</span>}
                    </TableCell>
                    <TableCell><Badge variant={p.estado === "verificado" ? "default" : p.estado === "pendiente" ? "secondary" : "destructive"}>{p.estado}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pgPag} />
          </div>
        </TabsContent>

        <TabsContent value="ordenes" className="mt-4">
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Nº</TableHead><TableHead>Fecha</TableHead><TableHead>Estado</TableHead><TableHead>Recepción</TableHead><TableHead className="text-right">Total (USD)</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {pgOc.pageItems.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">Sin órdenes de compra</TableCell></TableRow>
                ) : pgOc.pageItems.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-sm text-primary">{o.numero}{o.referencia_proveedor && <span className="block font-sans text-xs text-muted-foreground">Ref. {o.referencia_proveedor}</span>}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtFecha(o.fecha_orden)}</TableCell>
                    <TableCell><Badge variant={o.estado === "cancelada" ? "destructive" : "secondary"}>{ESTADO_OC[o.estado] ?? o.estado}</Badge></TableCell>
                    <TableCell className="text-muted-foreground">{o.estado_recepcion ? RECEPCION[o.estado_recepcion] ?? o.estado_recepcion : "—"}</TableCell>
                    <TableCell className="text-right font-semibold">{formatPrice(o.total_usd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pgOc} />
          </div>
        </TabsContent>

        <TabsContent value="retenciones" className="mt-4">
          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Comprobante</TableHead><TableHead>Tipo</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Base</TableHead><TableHead className="text-right">Retenido (USD)</TableHead><TableHead>Estado</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {pgRet.pageItems.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Sin retenciones emitidas</TableCell></TableRow>
                ) : pgRet.pageItems.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm text-primary">{r.numero}</TableCell>
                    <TableCell className="uppercase text-muted-foreground">{r.tipo}{r.porcentaje ? ` · ${r.porcentaje}%` : ""}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtFecha(r.fecha)}</TableCell>
                    <TableCell className="text-right">{formatPrice(r.base_imponible)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatPrice(r.total)}</TableCell>
                    <TableCell><Badge variant={r.estado === "confirmado" ? "default" : r.estado === "anulado" ? "destructive" : "secondary"}>{r.estado}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pgRet} />
          </div>
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default ProveedorDetalle;
