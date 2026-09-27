import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, FileText, Truck } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { OdooBadge } from "@/components/OdooBadge";

interface FacturaProvFull {
  id: string; numero: string; referencia: string | null; tipo: string; es_nota_debito: boolean; odoo_id: number | null; odoo_sync_at: string | null;
  proveedor_id: string | null; fecha_emision: string | null; fecha_vencimiento: string | null; moneda: string; tasa_cambio: number | null;
  subtotal: number; impuesto: number; total: number; total_usd: number; saldo_usd: number; estado_pago: string; estado: string;
  nro_control: string | null; motivo_anulacion: string | null;
  proveedor?: { id: string; nombre: string; rif: string | null; codigo: string } | null;
  origen?: { id: string; numero: string } | null;
  orden?: { numero: string } | null;
}
interface ItemRow { id: string; nombre_producto: string | null; cantidad: number; precio_unitario: number; descuento: number; subtotal: number; total: number; }
// Cómo se saldó en Odoo (conciliaciones): pago, nota de crédito, retención, reintegro u otro asiento
interface Aplicacion {
  id: string; tipo: string; monto_usd: number; fecha: string | null; descripcion: string | null;
  pago?: { numero: string } | null;
  documento?: { id: string; numero: string } | null;
  factura?: { id: string; numero: string } | null;
}
interface RetItem {
  id: string; concepto: string | null; base_imponible: number; porcentaje: number | null; monto: number;
  retencion?: { numero: string; tipo: string; fecha: string | null; estado: string | null } | null;
}
const TIPO_APLICACION: Record<string, string> = {
  pago: "Pago", nota_credito: "Nota de crédito", retencion: "Retención", reintegro: "Reintegro", otro: "Asiento contable",
};
const ESTADO_PAGO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" }, parcial: { label: "Parcial", variant: "outline" },
  pagado: { label: "Pagada", variant: "default" }, anulado: { label: "Anulada", variant: "destructive" },
};

const FacturaProveedorDetalle = () => {
  const { facturaId } = useParams();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [factura, setFactura] = useState<FacturaProvFull | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [aplicaciones, setAplicaciones] = useState<Aplicacion[]>([]);
  const [aplicadaA, setAplicadaA] = useState<Aplicacion[]>([]);
  const [retenciones, setRetenciones] = useState<RetItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      const selApl = "id, tipo, monto_usd, fecha, descripcion, pago:pagos_proveedor(numero), documento:documento_id(id, numero), factura:factura_proveedor_id(id, numero)";
      const [{ data: f }, { data: its }, { data: apl }, { data: aplA }, { data: ret }] = await Promise.all([
        supabase.from("facturas_proveedor")
          .select("*, proveedor:proveedores(id, nombre, rif, codigo), origen:factura_origen_id(id, numero), orden:ordenes_compra(numero)")
          .eq("id", facturaId).maybeSingle(),
        supabase.from("factura_proveedor_items").select("id, nombre_producto, cantidad, precio_unitario, descuento, subtotal, total").eq("factura_proveedor_id", facturaId),
        supabase.from("factura_proveedor_aplicaciones").select(selApl).eq("factura_proveedor_id", facturaId).order("fecha"),
        supabase.from("factura_proveedor_aplicaciones").select(selApl).eq("documento_id", facturaId).order("fecha"),
        supabase.from("retencion_emitida_items").select("id, concepto, base_imponible, porcentaje, monto, retencion:retenciones_emitidas(numero, tipo, fecha, estado)").eq("factura_proveedor_id", facturaId),
      ]);
      if (activo) {
        setFactura((f as unknown as FacturaProvFull) ?? null);
        setItems((its as ItemRow[]) ?? []);
        setAplicaciones((apl as unknown as Aplicacion[]) ?? []);
        setAplicadaA((aplA as unknown as Aplicacion[]) ?? []);
        setRetenciones((ret as unknown as RetItem[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [facturaId]);

  const esNotaCredito = factura?.tipo === "nota_credito";
  // Montos del documento en su moneda (Bs. o USD); total y saldo se muestran siempre en USD
  const fmtDoc = (n: number) => factura?.moneda === "VES"
    ? `Bs. ${Number(n || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtFecha = (d?: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString("es-VE", { day: "2-digit", month: "long", year: "numeric" }) : "—");

  const volver = (
    <Button variant="ghost" size="sm" className="mb-2 h-7 gap-1.5 px-2 text-xs" onClick={() => navigate(-1)}>
      <ArrowLeft className="h-3.5 w-3.5" /> Volver
    </Button>
  );

  if (loading) {
    return <MainLayout title="Factura de proveedor">{volver}<div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></MainLayout>;
  }
  if (!factura) {
    return (
      <MainLayout title="Factura de proveedor">
        {volver}
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <FileText className="mb-4 h-12 w-12 opacity-50" /><p>Factura de proveedor no encontrada</p>
        </div>
      </MainLayout>
    );
  }

  const totalRetenido = retenciones.reduce((s, r) => s + Number(r.monto || 0), 0);

  return (
    <MainLayout title={factura.numero}>
      {volver}

      <div className="mb-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-lg font-semibold text-primary">{factura.numero}</h1>
              <Badge variant={esNotaCredito ? "outline" : "secondary"}>{esNotaCredito ? "Nota de crédito" : factura.es_nota_debito ? "Nota de débito" : "Factura de proveedor"}</Badge>
              {factura.odoo_id && <OdooBadge sincronizado={factura.odoo_sync_at} />}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Emisión {fmtFecha(factura.fecha_emision)}{factura.fecha_vencimiento ? ` · Vence ${fmtFecha(factura.fecha_vencimiento)}` : ""}</p>
            {factura.origen && (
              <p className="mt-1 text-sm text-muted-foreground">
                {factura.es_nota_debito ? "Nota de débito de" : esNotaCredito ? "Nota de crédito de" : "Documento origen:"}{" "}
                <Link to={`/admin/facturas-proveedor/${factura.origen.id}`} className="font-mono font-medium text-primary hover:underline">{factura.origen.numero}</Link>
              </p>
            )}
            {factura.estado === "cancel" && (
              <p className="mt-1 text-sm text-destructive">Anulada en Odoo{factura.motivo_anulacion ? `: ${factura.motivo_anulacion}` : ""}</p>
            )}
          </div>
          <Badge variant={ESTADO_PAGO[factura.estado_pago]?.variant ?? "secondary"} className="text-sm">
            {ESTADO_PAGO[factura.estado_pago]?.label ?? factura.estado_pago}
          </Badge>
        </div>

        <div className="mt-3 grid gap-4 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Proveedor</p>
            {factura.proveedor ? (
              <Link to={`/admin/proveedores/${factura.proveedor.id}`} className="mt-0.5 flex items-center gap-1.5 font-medium text-primary hover:underline">
                <Truck className="h-4 w-4 shrink-0" /><span className="truncate">{factura.proveedor.nombre}</span>
              </Link>
            ) : <p className="mt-0.5 text-muted-foreground">—</p>}
            {factura.proveedor?.rif && <p className="font-mono text-xs text-muted-foreground">{factura.proveedor.rif}</p>}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Referencia del proveedor</p>
            <p className="mt-0.5 break-words font-medium">{factura.referencia || "—"}</p>
            {factura.nro_control && <p className="text-xs text-muted-foreground">Control {factura.nro_control}</p>}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Orden de compra</p>
            <p className="mt-0.5 font-mono font-medium">{factura.orden?.numero || "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Moneda</p>
            <p className="mt-0.5 font-medium">{factura.moneda === "VES" ? "Bolívares" : "Dólares"}{factura.moneda === "VES" && factura.tasa_cambio ? ` · tasa ${Number(factura.tasa_cambio).toLocaleString("es-VE", { maximumFractionDigits: 4 })}` : ""}</p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-4 border-t border-border pt-3 lg:grid-cols-5">
          <div><p className="text-xs text-muted-foreground">Subtotal</p><p className="font-semibold">{fmtDoc(factura.subtotal)}</p></div>
          <div><p className="text-xs text-muted-foreground">Impuesto</p><p className="font-semibold">{fmtDoc(factura.impuesto)}</p></div>
          <div><p className="text-xs text-muted-foreground">Total</p><p className="font-semibold">{fmtDoc(factura.total)}</p></div>
          <div><p className="text-xs text-muted-foreground">Total (USD)</p><p className="font-semibold">{formatPrice(Math.abs(factura.total_usd))}</p></div>
          <div>
            <p className="text-xs text-muted-foreground">{Number(factura.saldo_usd) < 0 ? "Saldo a favor (USD)" : "Saldo por pagar (USD)"}</p>
            <p className={`text-lg font-bold ${Number(factura.saldo_usd) > 0.009 ? "text-destructive" : Number(factura.saldo_usd) < -0.009 ? "text-success" : ""}`}>{formatPrice(Math.abs(factura.saldo_usd))}</p>
          </div>
        </div>
      </div>

      <div className="mb-3 rounded-lg border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-3 py-1.5"><h2 className="text-[13px] font-semibold">Líneas ({items.length})</h2></div>
        {items.length === 0 ? (
          <p className="p-5 text-center text-sm text-muted-foreground">Sin líneas de producto (documento de servicio o gasto).</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descripción</TableHead><TableHead className="text-center">Cant.</TableHead><TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Desc.</TableHead><TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">{it.nombre_producto || "—"}</TableCell>
                  <TableCell className="text-center">{it.cantidad}</TableCell>
                  <TableCell className="text-right">{fmtDoc(it.precio_unitario)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{it.descuento ? `${it.descuento}%` : "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtDoc(it.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="mb-3 rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <h2 className="text-[13px] font-semibold">Cómo se saldó ({aplicaciones.length})</h2><OdooBadge titulo="Conciliaciones registradas en Odoo" />
        </div>
        {aplicaciones.length === 0 ? (
          <p className="p-5 text-center text-sm text-muted-foreground">En Odoo todavía no hay pagos, retenciones ni notas de crédito aplicados a este documento.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Tipo</TableHead><TableHead>Documento</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Monto (USD)</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {aplicaciones.map((a) => (
                <TableRow key={a.id}>
                  <TableCell><Badge variant="outline">{TIPO_APLICACION[a.tipo] ?? a.tipo}</Badge></TableCell>
                  <TableCell className="font-mono text-sm">
                    {a.documento ? <Link to={`/admin/facturas-proveedor/${a.documento.id}`} className="text-primary hover:underline">{a.documento.numero}</Link>
                      : a.pago ? <span className="text-primary">{a.pago.numero}</span>
                      : <span className="text-muted-foreground">{a.descripcion || "—"}</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{fmtFecha(a.fecha)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPrice(a.monto_usd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {aplicadaA.length > 0 && (
        <div className="mb-3 rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
            <h2 className="text-[13px] font-semibold">Aplicada a ({aplicadaA.length})</h2><OdooBadge />
          </div>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Documento</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Monto (USD)</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {aplicadaA.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-sm">{a.factura ? <Link to={`/admin/facturas-proveedor/${a.factura.id}`} className="text-primary hover:underline">{a.factura.numero}</Link> : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtFecha(a.fecha)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPrice(a.monto_usd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <h2 className="text-[13px] font-semibold">Retenciones emitidas ({retenciones.length})</h2>
          {retenciones.length > 0 && <span className="text-sm text-muted-foreground">· {formatPrice(totalRetenido)}</span>}
        </div>
        {retenciones.length === 0 ? (
          <p className="p-5 text-center text-sm text-muted-foreground">No se emitieron retenciones sobre este documento.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Comprobante</TableHead><TableHead>Tipo</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Base</TableHead><TableHead className="text-right">Retenido (USD)</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {retenciones.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm text-primary">
                    {r.retencion?.numero || "—"}
                    {r.concepto && <span className="block font-sans text-xs text-muted-foreground">{r.concepto}</span>}
                  </TableCell>
                  <TableCell className="uppercase text-muted-foreground">{r.retencion?.tipo || "—"}{r.porcentaje ? ` · ${r.porcentaje}%` : ""}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtFecha(r.retencion?.fecha)}</TableCell>
                  <TableCell className="text-right">{formatPrice(r.base_imponible)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPrice(r.monto)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </MainLayout>
  );
};

export default FacturaProveedorDetalle;
