import { useEffect, useState } from "react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { Link } from "react-router-dom";
import { EstadoVacio, EstadoPill, Panel, PillTono, SkeletonFilas, fechaCorta, type Tono } from "@/components/portal/sistema";
import { NavFinanzas } from "@/components/portal/finanzas";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Boxes } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { DeclararVentaForm, cargarStockConsignacion, type StockConsignacion } from "@/components/consignacion/DeclararVentaForm";

interface Almacen { id: string; nombre: string; }
interface Declaracion {
  id: string; numero: string; estado: string; fecha: string; total: number;
  factura_id: string | null; factura?: { numero: string } | null;   // factura interna (declaraciones aprobadas antes de 22b)
  // Pedido creado al aprobar (22b): sigue su camino en Odoo hasta la factura
  orden?: { id: string; numero: string; numero_guds: string | null; odoo_id: number | null; aprobacion: string | null; estado: string;
    estado_odoo: string | null; facturas?: { numero: string; tipo: string; estado_pago: string | null }[] | null } | null;
}

const facturaDe = (d: Declaracion) =>
  (d.orden?.facturas ?? []).find((f) => f.tipo === "factura" && f.estado_pago !== "anulado")?.numero ?? d.factura?.numero ?? null;

const ESTADO: Record<string, { label: string; tono: Tono }> = {
  pendiente: { label: "Pendiente", tono: "pendiente" },
  aprobado: { label: "Aprobado", tono: "ok" },
  rechazado: { label: "Rechazado", tono: "riesgo" },
};

const PortalConsignacion = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [almacen, setAlmacen] = useState<Almacen | null>(null);
  const [stock, setStock] = useState<StockConsignacion[]>([]);
  const [declaraciones, setDeclaraciones] = useState<Declaracion[]>([]);
  const [loading, setLoading] = useState(true);

  const cargar = async () => {
    if (!user?.cliente_id) return;
    setLoading(true);
    const { data: alm } = await supabase.from("almacenes").select("id, nombre")
      .eq("cliente_id", user.cliente_id).eq("tipo", "consignacion").eq("activo", true).maybeSingle();
    setAlmacen((alm as Almacen) ?? null);
    if (alm) setStock(await cargarStockConsignacion(alm.id));
    const { data: decs } = await supabase.from("declaraciones_consignacion")
      .select("id, numero, estado, fecha, total, factura_id, factura:facturas(numero), orden:ordenes(id, numero, numero_guds, odoo_id, aprobacion, estado, estado_odoo, facturas(numero, tipo, estado_pago))")
      .eq("cliente_id", user.cliente_id).order("created_at", { ascending: false });
    setDeclaraciones((decs as unknown as Declaracion[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { cargar(); }, [user?.cliente_id]);

  return (
    <PortalPagina titulo="Consignación" descripcion="Declara lo que vendiste del inventario que tienes en consignación. Al aprobarse se convierte en un pedido y la factura llega cuando se procese.">
      <NavFinanzas />
      {loading ? (
        <SkeletonFilas n={2} alto="h-48" />
      ) : !almacen ? (
        <div className="rounded-xl border border-border bg-card">
          <EstadoVacio icono={Boxes} titulo="No tienes inventario en consignación" descripcion="Si trabajas con consignación, tu ejecutivo de cuenta puede asignarte un almacén." />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
          <Panel titulo="Declarar venta" descripcion={almacen.nombre}>
            <DeclararVentaForm almacenId={almacen.id} stock={stock} onDeclarado={cargar} />
          </Panel>

          <Panel titulo={`Mis declaraciones (${declaraciones.length})`} cuerpoClassName="p-0 sm:p-0">
            {declaraciones.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">Todavía no has declarado ninguna venta.</p>
            ) : (
              <>
              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Nº</TableHead><TableHead>Fecha</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Estado</TableHead><TableHead>Pedido</TableHead><TableHead>Factura</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {declaraciones.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-sm">{d.numero}</TableCell>
                      <TableCell className="text-muted-foreground">{fechaCorta(d.fecha)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatPrice(d.total)}</TableCell>
                      <TableCell><PillTono tono={ESTADO[d.estado]?.tono ?? "neutro"}>{ESTADO[d.estado]?.label ?? d.estado}</PillTono></TableCell>
                      <TableCell>
                        {d.orden ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Link to={`/portal/pedidos?pedido=${d.orden.id}`} className="font-mono text-sm text-primary hover:underline">{d.orden.numero}</Link>
                            <EstadoPill pedido={d.orden} />
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-muted-foreground">{facturaDe(d) || (d.orden ? "Por facturar" : "—")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {/* Móvil: una fila por declaración */}
              <ul className="divide-y divide-border md:hidden" data-testid="consignacion-lista">
                {declaraciones.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium tabular-nums">{d.numero}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {fechaCorta(d.fecha)}
                        {d.orden && <> · Pedido <Link to={`/portal/pedidos?pedido=${d.orden.id}`} className="font-mono text-primary hover:underline">{d.orden.numero}</Link></>}
                        {facturaDe(d) ? ` · Factura ${facturaDe(d)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="text-sm font-semibold tabular-nums">{formatPrice(d.total)}</span>
                      <PillTono tono={ESTADO[d.estado]?.tono ?? "neutro"}>{ESTADO[d.estado]?.label ?? d.estado}</PillTono>
                    </div>
                  </li>
                ))}
              </ul>
              </>
            )}
          </Panel>
        </div>
      )}
    </PortalPagina>
  );
};

export default PortalConsignacion;
