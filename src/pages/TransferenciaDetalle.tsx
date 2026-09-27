import { Fragment, useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, ArrowLeftRight, Undo2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { OdooBadge } from "@/components/OdooBadge";
import { EstadoTransferencia, TIPO_TRANSF, fmtFechaHora } from "@/components/inventario/EstadoTransferencia";
import { VencimientoBadge } from "@/components/inventario/VencimientoBadge";

interface Ref { id: string; numero: string }
interface TransferenciaFull {
  id: string; numero: string; tipo: string; tipo_operacion: string | null; estado: string; origen: string | null; contacto: string | null;
  ubicacion_origen: string | null; ubicacion_destino: string | null; fecha_programada: string | null; fecha_limite: string | null;
  fecha_realizada: string | null; responsable: string | null; transportista: string | null; notas: string | null; odoo_sync_at: string | null;
  cliente?: { id: string; nombre_negocio: string } | null;
  proveedor?: { id: string; nombre: string } | null;
  orden?: Ref | null;
  orden_compra?: Ref | null;
  almacen_origen?: { id: string; nombre: string } | null;
  almacen_destino?: { id: string; nombre: string } | null;
  devolucion_de?: Ref | null;
  pendiente_de?: Ref | null;
}
interface Item {
  id: string; nombre_producto: string | null; cantidad_demandada: number; cantidad_hecha: number; estado: string | null;
  producto?: { id: string; nombre: string; sku: string } | null;
}
interface LineaLote {
  id: string; item_id: string | null; cantidad: number; lote_nombre: string | null;
  lote?: { id: string; nombre: string; vencimiento: string | null; es_serie: boolean } | null;
}

function Dato({ label, children }: { label: string; children?: React.ReactNode }) {
  const vacio = children === null || children === undefined || children === "";
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 break-words font-medium">{vacio ? <span className="font-normal text-muted-foreground">—</span> : children}</div>
    </div>
  );
}

const TransferenciaDetalle = () => {
  const { transferenciaId } = useParams();
  const navigate = useNavigate();
  const [t, setT] = useState<TransferenciaFull | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [lineas, setLineas] = useState<LineaLote[]>([]);
  const [devoluciones, setDevoluciones] = useState<(Ref & { estado: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      const [{ data: tr }, { data: its }, { data: lns }, { data: dev }] = await Promise.all([
        supabase.from("transferencias").select(`*, cliente:clientes(id, nombre_negocio), proveedor:proveedores(id, nombre), orden:ordenes(id, numero),
          orden_compra:ordenes_compra(id, numero), almacen_origen:almacen_origen_id(id, nombre), almacen_destino:almacen_destino_id(id, nombre),
          devolucion_de:devolucion_de_id(id, numero), pendiente_de:pendiente_de_id(id, numero)`).eq("id", transferenciaId).maybeSingle(),
        supabase.from("transferencia_items").select("id, nombre_producto, cantidad_demandada, cantidad_hecha, estado, producto:productos(id, nombre, sku)").eq("transferencia_id", transferenciaId),
        supabase.from("transferencia_lotes").select("id, item_id, cantidad, lote_nombre, lote:lotes(id, nombre, vencimiento, es_serie)").eq("transferencia_id", transferenciaId),
        supabase.from("transferencias").select("id, numero, estado").eq("devolucion_de_id", transferenciaId),
      ]);
      if (activo) {
        setT((tr as unknown as TransferenciaFull) ?? null);
        setItems((its as unknown as Item[]) ?? []);
        setLineas((lns as unknown as LineaLote[]) ?? []);
        setDevoluciones((dev as unknown as (Ref & { estado: string })[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [transferenciaId]);

  const volver = (
    <Button variant="ghost" size="sm" className="mb-2 h-7 gap-1.5 px-2 text-xs" onClick={() => navigate(-1)}>
      <ArrowLeft className="h-3.5 w-3.5" /> Volver
    </Button>
  );
  if (loading) return <MainLayout title="Transferencia">{volver}<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></MainLayout>;
  if (!t) {
    return (
      <MainLayout title="Transferencia">
        {volver}
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground"><ArrowLeftRight className="mb-4 h-12 w-12 opacity-50" /><p>Transferencia no encontrada</p></div>
      </MainLayout>
    );
  }

  const lotesDe = (itemId: string) => lineas.filter((l) => l.item_id === itemId);
  const contacto = t.cliente
    ? <Link to={`/admin/clientes/${t.cliente.id}`} className="text-primary hover:underline">{t.cliente.nombre_negocio}</Link>
    : t.proveedor ? <Link to={`/admin/proveedores/${t.proveedor.id}`} className="text-primary hover:underline">{t.proveedor.nombre}</Link>
    : t.contacto;

  return (
    <MainLayout title={t.numero}>
      {volver}

      <div className="mb-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-lg font-semibold text-primary">{t.numero}</h1>
              <Badge variant="secondary">{TIPO_TRANSF[t.tipo] ?? t.tipo}</Badge>
              <OdooBadge sincronizado={t.odoo_sync_at} titulo="Transferencia de Odoo: se valida y procesa en Odoo" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t.tipo_operacion}</p>
            {t.devolucion_de && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Undo2 className="h-4 w-4" /> Devolución de{" "}
                <Link to={`/admin/transferencias/${t.devolucion_de.id}`} className="font-mono text-primary hover:underline">{t.devolucion_de.numero}</Link></p>
            )}
            {t.pendiente_de && (
              <p className="mt-1 text-sm text-muted-foreground">Pendiente (entrega parcial) de{" "}
                <Link to={`/admin/transferencias/${t.pendiente_de.id}`} className="font-mono text-primary hover:underline">{t.pendiente_de.numero}</Link></p>
            )}
          </div>
          <EstadoTransferencia estado={t.estado} />
        </div>

        <div className="mt-3 grid gap-4 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <Dato label={t.tipo === "recepcion" ? "Proveedor / contacto" : "Cliente / contacto"}>{contacto}</Dato>
          <Dato label="Documento origen">
            {t.orden ? <Link to={`/admin/ordenes?orden=${t.orden.id}`} className="font-mono text-primary hover:underline">{t.orden.numero}</Link>
              : t.orden_compra ? <span className="font-mono">{t.orden_compra.numero}</span> : t.origen}
          </Dato>
          <Dato label="Desde">
            {t.almacen_origen ? <Link to={`/admin/almacenes/${t.almacen_origen.id}`} className="text-primary hover:underline">{t.ubicacion_origen}</Link> : t.ubicacion_origen}
          </Dato>
          <Dato label="Hacia">
            {t.almacen_destino ? <Link to={`/admin/almacenes/${t.almacen_destino.id}`} className="text-primary hover:underline">{t.ubicacion_destino}</Link> : t.ubicacion_destino}
          </Dato>
          <Dato label="Programada">{fmtFechaHora(t.fecha_programada)}</Dato>
          <Dato label="Fecha límite">{t.fecha_limite ? fmtFechaHora(t.fecha_limite) : null}</Dato>
          <Dato label="Realizada">{t.fecha_realizada ? fmtFechaHora(t.fecha_realizada) : null}</Dato>
          <Dato label="Responsable / transportista">{[t.responsable, t.transportista].filter(Boolean).join(" · ")}</Dato>
        </div>
        {t.notas && <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">{t.notas}</p>}
        {devoluciones.length > 0 && (
          <p className="mt-4 text-sm text-muted-foreground">Devoluciones:{" "}
            {devoluciones.map((d, i) => (
              <Fragment key={d.id}>{i > 0 && ", "}<Link to={`/admin/transferencias/${d.id}`} className="font-mono text-primary hover:underline">{d.numero}</Link></Fragment>
            ))}
          </p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-3 py-1.5"><h2 className="text-[13px] font-semibold">Productos ({items.length})</h2></div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto / lote</TableHead>
              <TableHead className="text-right">Demanda</TableHead>
              <TableHead className="text-right">Hecho</TableHead>
              <TableHead>Vencimiento</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">Sin productos</TableCell></TableRow>
            ) : items.map((it) => (
              <Fragment key={it.id}>
                <TableRow className="bg-muted/20">
                  <TableCell>
                    <p className="font-medium">{it.producto?.nombre || it.nombre_producto || "—"}</p>
                    {it.producto?.sku && <p className="font-mono text-xs text-muted-foreground">{it.producto.sku}</p>}
                  </TableCell>
                  <TableCell className="text-right">{Number(it.cantidad_demandada).toLocaleString("es-VE")}</TableCell>
                  <TableCell className={`text-right font-semibold ${Number(it.cantidad_hecha) < Number(it.cantidad_demandada) && t.estado === "hecha" ? "text-warning" : ""}`}>
                    {Number(it.cantidad_hecha).toLocaleString("es-VE")}
                  </TableCell>
                  <TableCell />
                </TableRow>
                {lotesDe(it.id).map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="pl-8 font-mono text-sm">
                      {l.lote ? <Link to={`/admin/lotes/${l.lote.id}`} className="text-primary hover:underline">{l.lote.nombre}</Link> : l.lote_nombre}
                      {l.lote?.es_serie && <Badge variant="outline" className="ml-2 px-1 py-0 font-sans text-[10px]">Serie</Badge>}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right text-sm">{Number(l.cantidad).toLocaleString("es-VE")}</TableCell>
                    <TableCell>{l.lote && <VencimientoBadge vencimiento={l.lote.vencimiento} conFecha />}</TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </MainLayout>
  );
};

export default TransferenciaDetalle;
