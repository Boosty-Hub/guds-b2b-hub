import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { ArrowLeft, Loader2, Building2, FileText, FileMinus, HandCoins, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";

interface ClienteLite { id: string; nombre_negocio: string; codigo: string | null; limite_credito: number; }
interface FacturaRow {
  id: string; numero: string; tipo: string; fecha_emision: string | null; fecha_vencimiento: string | null;
  total_usd: number; saldo_usd: number; estado_cobro: string;
}
interface PagoRow {
  id: string; numero: string; monto: number; moneda: string; monto_moneda: number | null; estado: string;
  created_at: string; fecha_verificacion: string | null; banco?: { nombre: string } | null;
}
interface PagoFacturaRow { pago_id: string; factura_id: string; monto_aplicado: number; factura?: { numero: string } | null; }
interface RetencionRow { id: string; numero: string; tipo: string; estado: string; fecha: string; total: number; odoo_id: number | null; }

const ESTADO_RETENCION: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  aprobado: { label: "Aprobado", variant: "default" },
  rechazado: { label: "Rechazado", variant: "destructive" },
};

const ESTADO_COBRO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  parcial: { label: "Parcial", variant: "outline" },
  pagado: { label: "Pagada", variant: "default" },
  anulado: { label: "Anulada", variant: "destructive" },
};

const CuentaDetalle = () => {
  const { clienteId } = useParams();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const [cliente, setCliente] = useState<ClienteLite | null>(null);
  const [facturas, setFacturas] = useState<FacturaRow[]>([]);
  const [pagos, setPagos] = useState<PagoRow[]>([]);
  const [pagoFacturas, setPagoFacturas] = useState<PagoFacturaRow[]>([]);
  const [retenciones, setRetenciones] = useState<RetencionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      const [{ data: cli }, { data: facs }, { data: pgs }, { data: rets }] = await Promise.all([
        supabase.from("clientes").select("id, nombre_negocio, codigo, limite_credito").eq("id", clienteId).maybeSingle(),
        supabase.from("facturas").select("id, numero, tipo, fecha_emision, fecha_vencimiento, total_usd, saldo_usd, estado_cobro").eq("cliente_id", clienteId).eq("estado", "posted").order("fecha_emision", { ascending: false }),
        supabase.from("pagos").select("id, numero, monto, moneda, monto_moneda, estado, created_at, fecha_verificacion, banco:bancos(nombre)").eq("cliente_id", clienteId).order("created_at", { ascending: false }),
        supabase.from("retenciones").select("id, numero, tipo, estado, fecha, total, odoo_id").eq("cliente_id", clienteId).order("fecha", { ascending: false }),
      ]);
      let pf: PagoFacturaRow[] = [];
      if (pgs?.length) {
        const { data } = await supabase.from("pago_facturas").select("pago_id, factura_id, monto_aplicado, factura:facturas(numero)").in("pago_id", pgs.map((p) => p.id));
        pf = (data as unknown as PagoFacturaRow[]) ?? [];
      }
      if (activo) {
        setCliente((cli as ClienteLite) ?? null);
        setFacturas((facs as FacturaRow[]) ?? []);
        setPagos((pgs as PagoRow[]) ?? []);
        setPagoFacturas(pf);
        setRetenciones((rets as RetencionRow[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [clienteId]);

  const facturasNormales = facturas.filter((f) => f.tipo === "factura");
  const notasCredito = facturas.filter((f) => f.tipo === "nota_credito");
  const saldoTotal = facturas.reduce((s, f) => s + Number(f.saldo_usd || 0), 0);
  const pagosVerificados = pagos.filter((p) => p.estado === "verificado");

  const facPag = usePagination(facturasNormales, 10);
  const ncPag = usePagination(notasCredito, 10);
  const pagPag = usePagination(pagos, 10);

  const facturasAplicadasPorPago = (pagoId: string) => pagoFacturas.filter((pf) => pf.pago_id === pagoId);

  const fmtFecha = (d?: string | null) => (d ? new Date(d).toLocaleDateString("es-VE", { day: "2-digit", month: "short", year: "numeric" }) : "—");

  const volver = (
    <Button variant="ghost" className="mb-4 gap-2" onClick={() => navigate("/admin/cuentas")}>
      <ArrowLeft className="h-4 w-4" /> Volver a cuentas
    </Button>
  );

  if (loading) {
    return (
      <MainLayout title="Cuenta">
        {volver}
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      </MainLayout>
    );
  }

  if (!cliente) {
    return (
      <MainLayout title="Cuenta">
        {volver}
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Building2 className="mb-4 h-12 w-12 opacity-50" />
          <p>Cliente no encontrado</p>
        </div>
      </MainLayout>
    );
  }

  const iniciales = cliente.nombre_negocio.split(" ").map((w) => w[0]).join("").slice(0, 2);

  return (
    <MainLayout title={cliente.nombre_negocio}>
      {volver}

      <div className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14">
            <AvatarFallback className="bg-primary/10 text-lg text-primary">{iniciales}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold">{cliente.nombre_negocio}</h1>
            <p className="font-mono text-sm text-muted-foreground">{cliente.codigo}</p>
          </div>
        </div>
        <div className="flex gap-6">
          <div className="text-right">
            <p className={`text-2xl font-bold ${saldoTotal > 0.009 ? "text-destructive" : ""}`}>{formatPrice(saldoTotal)}</p>
            <p className="text-sm text-muted-foreground">Saldo deudor</p>
          </div>
          <Link to="/admin/clientes"><Button variant="outline" className="gap-2"><Building2 className="h-4 w-4" /> Ver cliente</Button></Link>
        </div>
      </div>

      {/* Facturas */}
      <div className="mb-6 rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-primary/10 p-1.5"><FileText className="h-4 w-4 text-primary" /></div>
            <h2 className="font-semibold">Facturas ({facturasNormales.length})</h2>
          </div>
        </div>
        {facturasNormales.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">Este cliente no tiene facturas.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº</TableHead>
                  <TableHead>Emisión</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {facPag.pageItems.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-sm text-primary">{f.numero}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtFecha(f.fecha_emision)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtFecha(f.fecha_vencimiento)}</TableCell>
                    <TableCell className="text-right">{formatPrice(f.total_usd)}</TableCell>
                    <TableCell className={`text-right font-semibold ${f.saldo_usd > 0.009 ? "text-destructive" : ""}`}>{formatPrice(f.saldo_usd)}</TableCell>
                    <TableCell><Badge variant={ESTADO_COBRO[f.estado_cobro]?.variant ?? "secondary"}>{ESTADO_COBRO[f.estado_cobro]?.label ?? f.estado_cobro}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination pagination={facPag} />
          </>
        )}
      </div>

      {/* Notas de crédito */}
      {notasCredito.length > 0 && (
        <div className="mb-6 rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-warning/10 p-1.5"><FileMinus className="h-4 w-4 text-warning" /></div>
              <h2 className="font-semibold">Notas de crédito ({notasCredito.length})</h2>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead>
                <TableHead>Emisión</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ncPag.pageItems.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-mono text-sm text-primary">{f.numero}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtFecha(f.fecha_emision)}</TableCell>
                  <TableCell className="text-right">{formatPrice(f.total_usd)}</TableCell>
                  <TableCell className="text-right font-semibold text-success">{formatPrice(f.saldo_usd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DataTablePagination pagination={ncPag} />
        </div>
      )}

      {/* Pagos */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-success/10 p-1.5"><HandCoins className="h-4 w-4 text-success" /></div>
            <h2 className="font-semibold">Pagos ({pagos.length})</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Verificados: <span className="font-semibold text-foreground">{formatPrice(pagosVerificados.reduce((s, p) => s + Number(p.monto), 0))}</span>
          </p>
        </div>
        {pagos.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">Este cliente no tiene pagos registrados.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº</TableHead>
                  <TableHead>Banco</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Aplicado a</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagPag.pageItems.map((p) => {
                  const aplicaciones = facturasAplicadasPorPago(p.id);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-sm text-primary">{p.numero}</TableCell>
                      <TableCell className="text-muted-foreground">{p.banco?.nombre || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{fmtFecha(p.fecha_verificacion || p.created_at)}</TableCell>
                      <TableCell>
                        <Badge variant={p.estado === "verificado" ? "default" : p.estado === "pendiente" ? "secondary" : "destructive"}>{p.estado}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{formatPrice(p.monto)}</TableCell>
                      <TableCell className="max-w-xs">
                        {aplicaciones.length === 0 ? (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground"><Wallet className="h-3 w-3" /> Sin aplicar (anticipo)</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {aplicaciones.map((a) => (
                              <span key={a.factura_id} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                {a.factura?.numero} · {formatPrice(a.monto_aplicado)}
                              </span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pagPag} />
          </>
        )}
      </div>

      {retenciones.length > 0 && (
        <div className="mt-6 rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border p-5"><h2 className="font-semibold">Retenciones ({retenciones.length})</h2></div>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Nº</TableHead><TableHead>Tipo</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Estado</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {retenciones.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-sm text-primary">{r.numero}{r.odoo_id && <span className="ml-1 text-xs text-muted-foreground">(Odoo)</span>}</TableCell>
                  <TableCell className="uppercase text-muted-foreground">{r.tipo}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtFecha(r.fecha)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatPrice(r.total)}</TableCell>
                  <TableCell><Badge variant={ESTADO_RETENCION[r.estado]?.variant ?? "secondary"}>{ESTADO_RETENCION[r.estado]?.label ?? r.estado}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </MainLayout>
  );
};

export default CuentaDetalle;
