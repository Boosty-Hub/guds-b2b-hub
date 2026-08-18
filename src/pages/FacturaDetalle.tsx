import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, FileText, Building2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";

interface FacturaFull {
  id: string; numero: string; tipo: string; cliente_id: string;
  fecha_emision: string | null; fecha_vencimiento: string | null;
  moneda: string; tasa_cambio: number | null;
  subtotal: number; impuesto: number; total: number;
  total_usd: number; saldo_usd: number; estado_cobro: string; estado_pago: string;
  referencia: string | null; nro_control: string | null; vendedor_odoo: string | null;
  orden_id: string | null; creada_en_guds: boolean;
  cliente?: { nombre_negocio: string; codigo: string | null; rif: string | null } | null;
  orden?: { numero: string } | null;
}
interface ItemRow { id: string; nombre_producto: string | null; sku_producto: string | null; cantidad: number; precio_unitario: number; descuento: number; subtotal: number; total: number; }
interface PagoAplicado { pago_id: string; monto_aplicado: number; pago?: { numero: string; created_at: string; metodo: string } | null; }
interface RetencionAplicada { retencion_id: string; monto_aplicado: number; retencion?: { numero: string; tipo: string; fecha: string } | null; }

const ESTADO_COBRO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  parcial: { label: "Parcial", variant: "outline" },
  pagado: { label: "Pagada", variant: "default" },
  anulado: { label: "Anulada", variant: "destructive" },
};

const FacturaDetalle = () => {
  const { facturaId } = useParams();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [factura, setFactura] = useState<FacturaFull | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [pagosAplicados, setPagosAplicados] = useState<PagoAplicado[]>([]);
  const [retencionesAplicadas, setRetencionesAplicadas] = useState<RetencionAplicada[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      const { data: f } = await supabase.from("facturas")
        .select("*, cliente:clientes(nombre_negocio, codigo, rif), orden:ordenes(numero)")
        .eq("id", facturaId).maybeSingle();
      const { data: its } = await supabase.from("factura_items").select("id, nombre_producto, sku_producto, cantidad, precio_unitario, descuento, subtotal, total").eq("factura_id", facturaId);
      const { data: pf } = await supabase.from("pago_facturas").select("pago_id, monto_aplicado, pago:pagos(numero, created_at, metodo)").eq("factura_id", facturaId);
      const { data: rf } = await supabase.from("retencion_items").select("retencion_id, monto_aplicado, retencion:retenciones(numero, tipo, fecha)").eq("factura_id", facturaId);
      if (activo) {
        setFactura((f as FacturaFull) ?? null);
        setItems((its as ItemRow[]) ?? []);
        setPagosAplicados((pf as unknown as PagoAplicado[]) ?? []);
        setRetencionesAplicadas((rf as unknown as RetencionAplicada[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [facturaId]);

  const esNotaCredito = factura?.tipo === "nota_credito";
  const volverPath = esNotaCredito ? "/admin/notas-credito" : "/admin/facturas";
  const fmtFecha = (d?: string | null) => (d ? new Date(d).toLocaleDateString("es-VE", { day: "2-digit", month: "long", year: "numeric" }) : "—");

  const volver = (
    <Button variant="ghost" className="mb-4 gap-2" onClick={() => navigate(volverPath)}>
      <ArrowLeft className="h-4 w-4" /> Volver a {esNotaCredito ? "notas de crédito" : "facturas"}
    </Button>
  );

  if (loading) {
    return <MainLayout title="Factura">{volver}<div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></MainLayout>;
  }
  if (!factura) {
    return (
      <MainLayout title="Factura">
        {volver}
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <FileText className="mb-4 h-12 w-12 opacity-50" /><p>Factura no encontrada</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout title={factura.numero}>
      {volver}

      <div className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-2xl font-bold text-primary">{factura.numero}</h1>
              <Badge variant={esNotaCredito ? "outline" : "secondary"}>{esNotaCredito ? "Nota de crédito" : "Factura"}</Badge>
              {factura.creada_en_guds && <Badge variant="outline">Interna</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Emisión {fmtFecha(factura.fecha_emision)}{factura.fecha_vencimiento ? ` · Vence ${fmtFecha(factura.fecha_vencimiento)}` : ""}</p>
          </div>
          <Badge variant={ESTADO_COBRO[factura.estado_cobro]?.variant ?? "secondary"} className="text-sm">
            {ESTADO_COBRO[factura.estado_cobro]?.label ?? factura.estado_cobro}
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Cliente</p>
            <Link to={`/admin/cuentas/${factura.cliente_id}`} className="font-medium text-primary hover:underline">
              {factura.cliente?.nombre_negocio || "—"}
            </Link>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">RIF</p>
            <p className="font-mono font-medium">{factura.cliente?.rif || "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Nº control fiscal</p>
            <p className="font-mono font-medium">{factura.nro_control || "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Vendedor</p>
            <p className="font-medium">{factura.vendedor_odoo || "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Moneda documento</p>
            <p className="font-medium">{factura.moneda}{factura.tasa_cambio ? ` · tasa ${Number(factura.tasa_cambio).toLocaleString("es-VE")}` : ""}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Referencia</p>
            <p className="font-medium">{factura.referencia || "—"}</p>
          </div>
          {factura.orden && (
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Orden origen</p>
              <Link to="/admin/ordenes" className="font-mono font-medium text-primary hover:underline">{factura.orden.numero}</Link>
            </div>
          )}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">Subtotal</p><p className="font-medium">{formatPrice(factura.subtotal)}</p></div>
          <div><p className="text-xs text-muted-foreground">Impuesto</p><p className="font-medium">{formatPrice(factura.impuesto)}</p></div>
          <div><p className="text-xs text-muted-foreground">Total (USD)</p><p className="text-lg font-bold">{formatPrice(factura.total_usd)}</p></div>
          <div><p className="text-xs text-muted-foreground">Saldo (USD)</p><p className={`text-lg font-bold ${Math.abs(factura.saldo_usd) > 0.009 ? (factura.saldo_usd > 0 ? "text-destructive" : "text-success") : ""}`}>{formatPrice(factura.saldo_usd)}</p></div>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border p-5"><h2 className="font-semibold">Items ({items.length})</h2></div>
        {items.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">Sin líneas registradas.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead><TableHead>SKU</TableHead>
                <TableHead className="text-center">Cant.</TableHead>
                <TableHead className="text-right">Precio</TableHead>
                <TableHead className="text-right">Desc.</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className="font-medium">{it.nombre_producto || "—"}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{it.sku_producto || "—"}</TableCell>
                  <TableCell className="text-center">{it.cantidad}</TableCell>
                  <TableCell className="text-right">{formatPrice(it.precio_unitario)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{it.descuento ? `${it.descuento}%` : "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPrice(it.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border p-5"><h2 className="font-semibold">Pagos aplicados ({pagosAplicados.length})</h2></div>
        {pagosAplicados.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">Esta factura no tiene pagos aplicados todavía.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Pago</TableHead><TableHead>Fecha</TableHead><TableHead>Método</TableHead><TableHead className="text-right">Monto aplicado</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {pagosAplicados.map((p) => (
                <TableRow key={p.pago_id}>
                  <TableCell className="font-mono text-sm text-primary">{p.pago?.numero || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.pago?.created_at ? fmtFecha(p.pago.created_at) : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.pago?.metodo || "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPrice(p.monto_aplicado)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border p-5"><h2 className="font-semibold">Retenciones aplicadas ({retencionesAplicadas.length})</h2></div>
        {retencionesAplicadas.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">Esta factura no tiene retenciones aplicadas.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Retención</TableHead><TableHead>Tipo</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Monto retenido</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {retencionesAplicadas.map((r) => (
                <TableRow key={r.retencion_id}>
                  <TableCell className="font-mono text-sm text-primary">{r.retencion?.numero || "—"}</TableCell>
                  <TableCell className="uppercase text-muted-foreground">{r.retencion?.tipo || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{r.retencion?.fecha ? fmtFecha(r.retencion.fecha) : "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPrice(r.monto_aplicado)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </MainLayout>
  );
};

export default FacturaDetalle;
