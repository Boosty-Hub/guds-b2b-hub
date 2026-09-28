import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, FileText, Building2, History, Ban } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionsContext";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { OdooBadge } from "@/components/OdooBadge";

interface FacturaFull {
  id: string; numero: string; tipo: string; cliente_id: string;
  fecha_emision: string | null; fecha_vencimiento: string | null;
  moneda: string; tasa_cambio: number | null;
  subtotal: number; impuesto: number; total: number;
  total_usd: number; saldo_usd: number; estado_cobro: string; estado_pago: string;
  referencia: string | null; nro_control: string | null; vendedor_odoo: string | null;
  orden_id: string | null; creada_en_guds: boolean; odoo_id: number | null;
  es_nota_debito: boolean; factura_origen_id: string | null; motivo_anulacion: string | null; estado: string | null; anulada_at?: string | null;
  cliente?: { nombre_negocio: string; codigo: string | null; rif: string | null } | null;
  orden?: { numero: string } | null;
  origen?: { id: string; numero: string; tipo: string } | null;
}
// Cómo se saldó en Odoo (conciliaciones): cobro, nota de crédito, retención, reintegro u otro asiento
interface Aplicacion {
  id: string; tipo: string; monto_usd: number; fecha: string | null; descripcion: string | null;
  pago?: { id: string; numero: string; metodo: string } | null;
  documento?: { id: string; numero: string } | null;
  factura?: { id: string; numero: string } | null;
}
const TIPO_APLICACION: Record<string, string> = {
  pago: "Cobro", nota_credito: "Nota de crédito", retencion: "Retención", reintegro: "Reintegro", otro: "Asiento contable",
};
// Historial de la factura (migración 19x): alta, cambios y anulación, vengan de Odoo o de GUDS
interface Historial { id: number; accion: string; cambios: Record<string, unknown>; origen: string; created_at: string; usuario?: { nombre: string; apellido: string | null } | null }
const CAMPO: Record<string, string> = {
  estado: "Estado", estado_pago: "Estado de pago", estado_cobro: "Cobro", total: "Total", total_usd: "Total USD", saldo_usd: "Saldo USD",
  numero: "Número", fecha_emision: "Emisión", fecha_vencimiento: "Vencimiento", cliente_id: "Cliente", nro_control: "Nº de control",
  motivo_anulacion: "Motivo de anulación", anulada_at: "Anulada el", subtotal: "Subtotal", impuesto: "Impuesto", moneda: "Moneda", tipo: "Tipo",
};
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
  const [aplicaciones, setAplicaciones] = useState<Aplicacion[]>([]);
  const [aplicadaA, setAplicadaA] = useState<Aplicacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [historial, setHistorial] = useState<Historial[]>([]);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const { toast } = useToast();
  const { can } = usePermissions();

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      const { data: f } = await supabase.from("facturas")
        .select("*, cliente:clientes(nombre_negocio, codigo, rif), orden:ordenes(numero), origen:factura_origen_id(id, numero, tipo)")
        .eq("id", facturaId).maybeSingle();
      const { data: its } = await supabase.from("factura_items").select("id, nombre_producto, sku_producto, cantidad, precio_unitario, descuento, subtotal, total").eq("factura_id", facturaId);
      const { data: pf } = await supabase.from("pago_facturas").select("pago_id, monto_aplicado, pago:pagos(numero, created_at, metodo)").eq("factura_id", facturaId);
      const { data: rf } = await supabase.from("retencion_items").select("retencion_id, monto_aplicado, retencion:retenciones(numero, tipo, fecha)").eq("factura_id", facturaId);
      const selApl = "id, tipo, monto_usd, fecha, descripcion, pago:pagos(id, numero, metodo), documento:facturas!factura_aplicaciones_documento_id_fkey(id, numero), factura:facturas!factura_aplicaciones_factura_id_fkey(id, numero)";
      const [{ data: apl }, { data: aplA }, { data: hist }] = await Promise.all([
        supabase.from("factura_aplicaciones").select(selApl).eq("factura_id", facturaId).order("fecha"),
        supabase.from("factura_aplicaciones").select(selApl).eq("documento_id", facturaId).order("fecha"),
        supabase.from("facturas_historial").select("id, accion, cambios, origen, created_at, usuario:usuarios(nombre, apellido)").eq("factura_id", facturaId).order("created_at", { ascending: false }).limit(100),
      ]);
      if (activo) {
        setFactura((f as FacturaFull) ?? null);
        setItems((its as ItemRow[]) ?? []);
        setPagosAplicados((pf as unknown as PagoAplicado[]) ?? []);
        setRetencionesAplicadas((rf as unknown as RetencionAplicada[]) ?? []);
        setAplicaciones((apl as unknown as Aplicacion[]) ?? []);
        setAplicadaA((aplA as unknown as Aplicacion[]) ?? []);
        setHistorial((hist as unknown as Historial[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [facturaId, recarga]);

  const anular = async () => {
    setGuardando(true);
    const { error } = await supabase.rpc("anular_factura", { p_factura_id: facturaId, p_motivo: motivo });
    setGuardando(false);
    if (error) { toast({ title: "No se pudo anular", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Factura anulada", description: "Queda registrada con su motivo y en el historial." });
    setAnulando(false); setMotivo(""); setRecarga((n) => n + 1);
  };

  const esNotaCredito = factura?.tipo === "nota_credito";
  // Montos del documento en su moneda (Bs. o USD); total y saldo se muestran siempre en USD
  const fmtDoc = (n: number) => factura?.moneda === "VES"
    ? `Bs. ${Number(n || 0).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const volverPath = esNotaCredito ? "/admin/notas-credito" : "/admin/facturas";
  const fmtFecha = (d?: string | null) => (d ? new Date(d).toLocaleDateString("es-VE", { day: "2-digit", month: "long", year: "numeric" }) : "—");

  const volver = (
    <Button variant="ghost" size="sm" className="mb-2 h-7 gap-1.5 px-2 text-xs" onClick={() => navigate(volverPath)}>
      <ArrowLeft className="h-3.5 w-3.5" /> Volver a {esNotaCredito ? "notas de crédito" : "facturas"}
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

      <div className="mb-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-lg font-semibold text-primary">{factura.numero}</h1>
              <Badge variant={esNotaCredito ? "outline" : "secondary"}>{esNotaCredito ? "Nota de crédito" : factura.es_nota_debito ? "Nota de débito" : "Factura"}</Badge>
              {factura.creada_en_guds ? <Badge variant="outline">Interna (GUDS)</Badge> : factura.odoo_id && <OdooBadge />}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Emisión {fmtFecha(factura.fecha_emision)}{factura.fecha_vencimiento ? ` · Vence ${fmtFecha(factura.fecha_vencimiento)}` : ""}</p>
            {factura.origen && (
              <p className="mt-1 text-sm text-muted-foreground">
                {factura.es_nota_debito ? "Nota de débito de" : esNotaCredito ? "Nota de crédito de" : "Documento origen:"}{" "}
                <Link to={`/admin/facturas/${factura.origen.id}`} className="font-mono font-medium text-primary hover:underline">{factura.origen.numero}</Link>
              </p>
            )}
            {factura.estado === "cancel" && (
              <p className="mt-1 text-sm text-destructive">
                Anulada {factura.odoo_id ? "en Odoo" : "en GUDS"}
                {factura.anulada_at ? ` el ${fmtFecha(factura.anulada_at)}` : ""}{factura.motivo_anulacion ? `: ${factura.motivo_anulacion}` : ""}
              </p>
            )}
          </div>
          {!factura.odoo_id && factura.estado !== "cancel" && can("cuentas", "editar") && (
            <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={() => setAnulando(true)}><Ban className="h-3.5 w-3.5" /> Anular</Button>
          )}
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
          <div><p className="text-xs text-muted-foreground">Subtotal ({factura.moneda === "VES" ? "Bs." : "USD"})</p><p className="font-medium">{fmtDoc(factura.subtotal)}</p></div>
          <div><p className="text-xs text-muted-foreground">Impuesto ({factura.moneda === "VES" ? "Bs." : "USD"})</p><p className="font-medium">{fmtDoc(factura.impuesto)}</p></div>
          <div><p className="text-xs text-muted-foreground">Total (USD)</p><p className="text-base font-semibold">{formatPrice(factura.total_usd)}</p></div>
          <div><p className="text-xs text-muted-foreground">Saldo (USD)</p><p className={`text-lg font-bold ${Math.abs(factura.saldo_usd) > 0.009 ? (factura.saldo_usd > 0 ? "text-destructive" : "text-success") : ""}`}>{formatPrice(factura.saldo_usd)}</p></div>
        </div>
      </div>

      <div className="mb-3 rounded-lg border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-3 py-1.5"><h2 className="text-[13px] font-semibold">Items ({items.length})</h2></div>
        {items.length === 0 ? (
          <p className="p-5 text-center text-sm text-muted-foreground">Sin líneas registradas.</p>
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
                  <TableCell className="text-right">{fmtDoc(it.precio_unitario)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{it.descuento ? `${it.descuento}%` : "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtDoc(it.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {factura.odoo_id && (
        <div className="mb-3 rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
            <h2 className="text-[13px] font-semibold">Cómo se saldó ({aplicaciones.length})</h2><OdooBadge titulo="Conciliaciones registradas en Odoo" />
          </div>
          {aplicaciones.length === 0 ? (
            <p className="p-5 text-center text-sm text-muted-foreground">En Odoo todavía no hay cobros ni notas de crédito aplicados a este documento.</p>
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
                      {a.documento ? <Link to={`/admin/facturas/${a.documento.id}`} className="text-primary hover:underline">{a.documento.numero}</Link>
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
      )}

      {esNotaCredito && aplicadaA.length > 0 && (
        <div className="mb-3 rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
            <h2 className="text-[13px] font-semibold">Aplicada a ({aplicadaA.length})</h2><OdooBadge />
          </div>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Factura</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Monto (USD)</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {aplicadaA.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-sm">{a.factura ? <Link to={`/admin/facturas/${a.factura.id}`} className="text-primary hover:underline">{a.factura.numero}</Link> : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtFecha(a.fecha)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPrice(a.monto_usd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {(!factura.odoo_id || pagosAplicados.length > 0) && (
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-3 py-1.5"><h2 className="text-[13px] font-semibold">{factura.odoo_id ? "Pagos aplicados en GUDS" : "Pagos aplicados"} ({pagosAplicados.length})</h2></div>
        {pagosAplicados.length === 0 ? (
          <p className="p-5 text-center text-sm text-muted-foreground">Esta factura no tiene pagos aplicados todavía.</p>
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
      )}

      <div className="mt-3 rounded-lg border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-3 py-1.5"><h2 className="text-[13px] font-semibold">Retenciones aplicadas ({retencionesAplicadas.length})</h2></div>
        {retencionesAplicadas.length === 0 ? (
          <p className="p-5 text-center text-sm text-muted-foreground">Esta factura no tiene retenciones aplicadas.</p>
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

      <div className="mt-3 rounded-lg border border-border bg-card">
        <div className="flex items-center gap-1.5 border-b border-border bg-muted/30 px-3 py-1.5">
          <History className="h-3.5 w-3.5 text-muted-foreground" /><h2 className="text-[13px] font-semibold">Historial ({historial.length})</h2>
        </div>
        {historial.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">Sin cambios registrados desde que se activó el historial.</p>
        ) : (
          <ul className="divide-y divide-border">
            {historial.map((h) => (
              <li key={h.id} className="px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Badge variant={h.accion === "anulada" ? "destructive" : "outline"} className="text-[11px] capitalize">{h.accion}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(h.created_at).toLocaleString("es-VE", { dateStyle: "medium", timeStyle: "short" })} ·{" "}
                    {h.origen === "odoo" ? "desde Odoo" : h.usuario ? `${h.usuario.nombre} ${h.usuario.apellido || ""}`.trim() : "GUDS"}
                  </span>
                </div>
                {h.accion !== "creada" && (
                  <p className="mt-0.5 break-words text-xs text-muted-foreground">
                    {Object.entries(h.cambios || {}).map(([k, v]) => {
                      const [antes, despues] = Array.isArray(v) ? v : [null, v];
                      return `${CAMPO[k] || k}: ${antes ?? "—"} → ${despues ?? "—"}`;
                    }).join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={anulando} onOpenChange={setAnulando}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Anular factura {factura.numero}</DialogTitle>
            <DialogDescription>La factura no se elimina: queda anulada, con su motivo y en el historial, y deja de contar en cuentas por cobrar.</DialogDescription>
          </DialogHeader>
          <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo de la anulación" rows={3} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnulando(false)} disabled={guardando}>Cancelar</Button>
            <Button variant="destructive" onClick={anular} disabled={guardando || motivo.trim().length < 5}>{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Anular factura"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default FacturaDetalle;
