import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Boxes } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { DeclararVentaForm, cargarStockConsignacion, type StockConsignacion } from "@/components/consignacion/DeclararVentaForm";
import { EstadoPill } from "@/components/portal/sistema";
import { FiltrosLista, useFiltros, opcionesDe, coincide, enRango, contadorFiltrado } from "@/components/datos/FiltrosLista";

interface ClienteConsig { cliente_id: string; nombre: string; almacen_id: string; almacen_nombre: string; }
interface Declaracion {
  id: string; numero: string; estado: string; fecha: string; total: number;
  cliente_id: string; factura?: { numero: string } | null;   // factura interna (declaraciones aprobadas antes de 22b)
  // Pedido creado al aprobar (22b): sigue su camino en Odoo hasta la factura
  orden?: { id: string; numero: string; odoo_id: number | null; aprobacion: string | null; estado: string; estado_odoo: string | null;
    facturas?: { numero: string; tipo: string; estado_pago: string | null }[] | null } | null;
}

const facturaDe = (d: Declaracion) =>
  (d.orden?.facturas ?? []).find((f) => f.tipo === "factura" && f.estado_pago !== "anulado")?.numero ?? d.factura?.numero ?? null;

// 'YYYY-MM-DD' es un día local: new Date('2026-10-08') sería medianoche UTC y en Caracas mostraría el día anterior
const fechaDia = (s: string) => new Date(s.length === 10 ? `${s}T00:00:00` : s).toLocaleDateString("es-VE");

const ESTADO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  aprobado: { label: "Aprobado", variant: "default" },
  rechazado: { label: "Rechazado", variant: "destructive" },
};

const VendedorConsignacion = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [clientes, setClientes] = useState<ClienteConsig[]>([]);
  // El cliente elegido va en la URL (?cliente=): sobrevive a recargar y se puede compartir
  const [params, setParams] = useSearchParams();
  const clienteId = params.get("cliente") ?? "";
  const [stock, setStock] = useState<StockConsignacion[]>([]);
  const [declaraciones, setDeclaraciones] = useState<Declaracion[]>([]);
  const [loading, setLoading] = useState(true);

  const cargarClientes = async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("almacenes")
      .select("id, nombre, cliente:clientes!inner(id, nombre_negocio, vendedor_asignado_id)")
      .eq("tipo", "consignacion").eq("activo", true)
      .eq("cliente.vendedor_asignado_id", user.id);
    const lista = ((data as unknown as { id: string; nombre: string; cliente: { id: string; nombre_negocio: string } }[]) ?? [])
      .map((a) => ({ cliente_id: a.cliente.id, nombre: a.cliente.nombre_negocio, almacen_id: a.id, almacen_nombre: a.nombre }));
    setClientes(lista);
    setLoading(false);
  };

  useEffect(() => { cargarClientes(); }, [user?.id]);

  const cargarDetalle = async (cid: string) => {
    const c = clientes.find((x) => x.cliente_id === cid);
    if (!c) return;
    setStock(await cargarStockConsignacion(c.almacen_id));
    const { data: decs } = await supabase.from("declaraciones_consignacion")
      .select("id, numero, estado, fecha, total, cliente_id, factura:facturas(numero), orden:ordenes(id, numero, odoo_id, aprobacion, estado, estado_odoo, facturas(numero, tipo, estado_pago))")
      .eq("cliente_id", cid).order("created_at", { ascending: false });
    setDeclaraciones((decs as unknown as Declaracion[]) ?? []);
  };

  const elegirCliente = (cid: string) => {
    setParams((p) => { const n = new URLSearchParams(p); n.set("cliente", cid); n.delete("estado"); n.delete("fecha"); return n; }, { replace: true });
  };
  // Detalle del cliente de la URL (al elegirlo o al recargar)
  useEffect(() => {
    if (clienteId && clientes.some((c) => c.cliente_id === clienteId)) cargarDetalle(clienteId);
    else { setStock([]); setDeclaraciones([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId, clientes]);

  const clienteSel = clientes.find((c) => c.cliente_id === clienteId);

  // Filtros de las declaraciones del cliente (en la URL)
  const f = useFiltros([
    { clave: "estado", etiqueta: "Estado", principal: true, opciones: opcionesDe(declaraciones, (d) => d.estado, (_d, v) => ESTADO[v]?.label ?? v) },
    { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", principal: true },
  ]);
  const declFiltradas = declaraciones.filter((d) => coincide(d.estado, f.v("estado")) && enRango(d.fecha, f.v("fecha")));

  return (
    <VendedorLayout title="Consignación">
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : clientes.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center text-muted-foreground">
          <Boxes className="mb-3 h-10 w-10 opacity-50" />
          <p>Ninguno de tus clientes tiene inventario en consignación.</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="max-w-sm space-y-2">
            <Select value={clienteId} onValueChange={elegirCliente}>
              <SelectTrigger aria-label="Cliente con consignación"><SelectValue placeholder="Elige un cliente con consignación" /></SelectTrigger>
              <SelectContent>
                {clientes.map((c) => <SelectItem key={c.cliente_id} value={c.cliente_id}>{c.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {clienteSel && (
            <>
              <div className="rounded-lg border border-border bg-card p-3">
                <h2 className="mb-2 text-[13px] font-semibold">Declarar venta — {clienteSel.nombre} ({clienteSel.almacen_nombre})</h2>
                <DeclararVentaForm almacenId={clienteSel.almacen_id} stock={stock} onDeclarado={() => cargarDetalle(clienteId)} />
              </div>

              <div className="rounded-lg border border-border bg-card">
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
                  <h2 className="mr-auto text-[13px] font-semibold">Declaraciones de {clienteSel.nombre}{" "}
                    <span className="font-normal text-muted-foreground" data-contador="">({contadorFiltrado(declFiltradas.length, declaraciones.length, f.activos, "declaraciones")})</span>
                  </h2>
                  {declaraciones.length > 0 && <FiltrosLista filtros={f} resultados={declFiltradas.length} />}
                </div>
                {declaraciones.length === 0 ? (
                  <p className="p-5 text-center text-sm text-muted-foreground">Sin declaraciones todavía.</p>
                ) : declFiltradas.length === 0 ? (
                  <p className="p-5 text-center text-sm text-muted-foreground">
                    Ninguna declaración con esos filtros.
                    <button type="button" className="ml-2 font-medium text-primary hover:underline" onClick={f.limpiar}>Limpiar filtros</button>
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nº</TableHead><TableHead>Fecha</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Estado</TableHead><TableHead>Pedido</TableHead><TableHead>Factura</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {declFiltradas.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-mono text-sm text-primary">{d.numero}</TableCell>
                          <TableCell className="text-muted-foreground">{fechaDia(d.fecha)}</TableCell>
                          <TableCell className="text-right font-semibold">{formatPrice(d.total)}</TableCell>
                          <TableCell><Badge variant={ESTADO[d.estado]?.variant ?? "secondary"}>{ESTADO[d.estado]?.label ?? d.estado}</Badge></TableCell>
                          <TableCell className="whitespace-nowrap">
                            {d.orden ? (
                              <span className="flex flex-wrap items-center gap-1.5">
                                <Link to={`/vendedor/pedidos?pedido=${d.orden.id}`} className="font-mono text-sm text-primary hover:underline">{d.orden.numero}</Link>
                                <EstadoPill pedido={d.orden} />
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">{facturaDe(d) || (d.orden ? "Por facturar" : "—")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </VendedorLayout>
  );
};

export default VendedorConsignacion;
