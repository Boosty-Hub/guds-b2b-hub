import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, Tag } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { OdooBadge } from "@/components/OdooBadge";
import { VencimientoBadge, fmtFechaCorta } from "@/components/inventario/VencimientoBadge";
import { EstadoTransferencia, TIPO_TRANSF, fmtFechaHora } from "@/components/inventario/EstadoTransferencia";

interface Lote {
  id: string; nombre: string; es_serie: boolean; vencimiento: string | null; fecha_alerta: string | null; fecha_retiro: string | null;
  fecha_uso: string | null; cantidad: number; referencia: string | null; notas: string | null; odoo_sync_at: string | null;
  producto?: { id: string; nombre: string; sku: string; unidad: string | null } | null;
}
interface Existencia { id: string; ubicacion: string | null; cantidad: number; reservado: number; almacen?: { id: string; nombre: string; tipo: string } | null }
interface Movimiento {
  id: string; cantidad: number; fecha: string | null;
  transferencia?: {
    id: string; numero: string; tipo: string; estado: string; fecha_realizada: string | null; fecha_programada: string | null;
    ubicacion_origen: string | null; ubicacion_destino: string | null; contacto: string | null;
    cliente?: { id: string; nombre_negocio: string } | null; proveedor?: { id: string; nombre: string } | null;
  } | null;
}

interface Ajuste { id: string; sentido: string; cantidad: number; ubicacion_origen: string | null; ubicacion_destino: string | null; referencia: string | null; fecha: string | null }
// Fila de la trazabilidad: transferencia o ajuste de inventario
interface FilaTraza {
  key: string; fecha: string | null; titulo: string; subtitulo: string; contacto: string; origen: string | null; destino: string | null;
  cantidad: number; estado: React.ReactNode; link: string | null;
}
const SENTIDO: Record<string, string> = { entrada: "Ajuste: entrada", salida: "Ajuste: salida", traslado: "Ajuste: traslado" };

const LoteDetalle = () => {
  const { loteId } = useParams();
  const navigate = useNavigate();
  const [lote, setLote] = useState<Lote | null>(null);
  const [existencias, setExistencias] = useState<Existencia[]>([]);
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [ajustes, setAjustes] = useState<Ajuste[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let activo = true;
    (async () => {
      setLoading(true);
      const [{ data: l }, { data: ex }, { data: mv }, { data: aj }] = await Promise.all([
        supabase.from("lotes").select("*, producto:productos(id, nombre, sku, unidad)").eq("id", loteId).maybeSingle(),
        supabase.from("inventario_lotes").select("id, ubicacion, cantidad, reservado, almacen:almacenes(id, nombre, tipo)").eq("lote_id", loteId).order("cantidad", { ascending: false }),
        supabase.from("transferencia_lotes").select(`id, cantidad, fecha, transferencia:transferencias(id, numero, tipo, estado, fecha_realizada, fecha_programada,
          ubicacion_origen, ubicacion_destino, contacto, cliente:clientes(id, nombre_negocio), proveedor:proveedores(id, nombre))`).eq("lote_id", loteId).order("fecha", { ascending: false }),
        supabase.from("ajustes_inventario").select("id, sentido, cantidad, ubicacion_origen, ubicacion_destino, referencia, fecha").eq("lote_id", loteId),
      ]);
      if (activo) {
        setLote((l as unknown as Lote) ?? null);
        setExistencias((ex as unknown as Existencia[]) ?? []);
        setMovs((mv as unknown as Movimiento[]) ?? []);
        setAjustes((aj as unknown as Ajuste[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { activo = false; };
  }, [loteId]);

  // Clientes que recibieron el lote (entregas hechas), para retiros o reclamos
  const clientes = useMemo(() => {
    const m = new Map<string, { id: string | null; nombre: string; cantidad: number; ultima: string | null }>();
    for (const x of movs) {
      const t = x.transferencia;
      if (!t || t.tipo !== "entrega" || t.estado !== "hecha") continue;
      const k = t.cliente?.id || t.contacto || "—";
      const c = m.get(k) || { id: t.cliente?.id ?? null, nombre: t.cliente?.nombre_negocio || t.contacto || "—", cantidad: 0, ultima: null };
      c.cantidad += Number(x.cantidad || 0);
      if (!c.ultima || (t.fecha_realizada && t.fecha_realizada > c.ultima)) c.ultima = t.fecha_realizada;
      m.set(k, c);
    }
    return [...m.values()].sort((a, b) => b.cantidad - a.cantidad);
  }, [movs]);

  const traza = useMemo<FilaTraza[]>(() => [
    ...movs.filter((m) => m.transferencia).map((m) => {
      const t = m.transferencia!;
      return { key: m.id, fecha: t.fecha_realizada || m.fecha, titulo: t.numero, subtitulo: TIPO_TRANSF[t.tipo] ?? t.tipo,
        contacto: t.cliente?.nombre_negocio || t.proveedor?.nombre || t.contacto || "—", origen: t.ubicacion_origen, destino: t.ubicacion_destino,
        cantidad: Number(m.cantidad), estado: <EstadoTransferencia estado={t.estado} />, link: `/admin/transferencias/${t.id}` };
    }),
    ...ajustes.map((a) => ({ key: a.id, fecha: a.fecha, titulo: SENTIDO[a.sentido] ?? "Ajuste", subtitulo: a.referencia || "Ajuste de inventario",
      contacto: "—", origen: a.ubicacion_origen, destino: a.ubicacion_destino, cantidad: Number(a.cantidad),
      estado: <Badge variant="outline" className="font-normal">Ajuste</Badge>, link: null })),
  ].sort((x, y) => (y.fecha || "").localeCompare(x.fecha || "")), [movs, ajustes]);

  const volver = <Button variant="ghost" size="sm" className="mb-2 h-7 gap-1.5 px-2 text-xs" onClick={() => navigate(-1)}><ArrowLeft className="h-3.5 w-3.5" /> Volver</Button>;
  if (loading) return <MainLayout title="Lote">{volver}<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></MainLayout>;
  if (!lote) {
    return (
      <MainLayout title="Lote">
        {volver}
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground"><Tag className="mb-4 h-12 w-12 opacity-50" /><p>Lote no encontrado</p></div>
      </MainLayout>
    );
  }
  const totalExist = existencias.reduce((s, e) => s + Number(e.cantidad || 0), 0);

  return (
    <MainLayout title={`Lote ${lote.nombre}`}>
      {volver}
      <div className="mb-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-lg font-semibold text-primary">{lote.nombre}</h1>
              <Badge variant="secondary">{lote.es_serie ? "Número de serie" : "Lote"}</Badge>
              <OdooBadge sincronizado={lote.odoo_sync_at} />
            </div>
            <p className="mt-1 font-medium">{lote.producto?.nombre || "—"}</p>
            <p className="font-mono text-sm text-muted-foreground">{lote.producto?.sku}</p>
          </div>
          <VencimientoBadge vencimiento={lote.vencimiento} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4 border-t border-border pt-3 lg:grid-cols-5">
          <div><p className="text-xs text-muted-foreground">Vencimiento</p><p className="font-semibold">{lote.vencimiento ? fmtFechaCorta(lote.vencimiento) : "Sin fecha"}</p></div>
          <div><p className="text-xs text-muted-foreground">Alerta</p><p className="font-semibold">{fmtFechaCorta(lote.fecha_alerta)}</p></div>
          <div><p className="text-xs text-muted-foreground">Retiro</p><p className="font-semibold">{fmtFechaCorta(lote.fecha_retiro)}</p></div>
          <div><p className="text-xs text-muted-foreground">Existencia</p><p className="text-base font-semibold">{Number(lote.cantidad).toLocaleString("es-VE")} {lote.producto?.unidad || ""}</p></div>
          <div><p className="text-xs text-muted-foreground">Clientes que lo recibieron</p><p className="text-base font-semibold">{clientes.length}</p></div>
        </div>
        {(lote.referencia || lote.notas) && <p className="mt-4 rounded-lg bg-muted/50 p-3 text-sm">{[lote.referencia, lote.notas].filter(Boolean).join(" · ")}</p>}
      </div>

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border bg-muted/30 px-3 py-1.5"><h2 className="text-[13px] font-semibold">Dónde está ({existencias.length})</h2></div>
          <Table>
            <TableHeader><TableRow><TableHead>Ubicación</TableHead><TableHead className="text-right">Cantidad</TableHead><TableHead className="text-right">Reservado</TableHead></TableRow></TableHeader>
            <TableBody>
              {existencias.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">Sin existencia en almacenes</TableCell></TableRow>
              ) : existencias.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    {e.almacen ? <Link to={`/admin/almacenes/${e.almacen.id}`} className="font-medium text-primary hover:underline">{e.ubicacion}</Link> : e.ubicacion}
                    {e.almacen?.tipo === "consignacion" && <Badge variant="outline" className="ml-2 px-1 py-0 text-[10px]">Consignación</Badge>}
                  </TableCell>
                  <TableCell className="text-right font-semibold">{Number(e.cantidad).toLocaleString("es-VE")}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{Number(e.reservado) > 0 ? Number(e.reservado).toLocaleString("es-VE") : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {existencias.length > 1 && <div className="border-t border-border px-4 py-2.5 text-right text-sm text-muted-foreground">Total {totalExist.toLocaleString("es-VE")}</div>}
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border bg-muted/30 px-3 py-1.5"><h2 className="text-[13px] font-semibold">Clientes que lo recibieron ({clientes.length})</h2></div>
          <Table>
            <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead className="text-right">Cantidad</TableHead><TableHead>Última entrega</TableHead></TableRow></TableHeader>
            <TableBody>
              {clientes.length === 0 ? (
                <TableRow><TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">Todavía no se ha entregado a clientes</TableCell></TableRow>
              ) : clientes.map((c) => (
                <TableRow key={c.id || c.nombre}>
                  <TableCell>{c.id ? <Link to={`/admin/clientes/${c.id}`} className="font-medium text-primary hover:underline">{c.nombre}</Link> : c.nombre}</TableCell>
                  <TableCell className="text-right font-semibold">{c.cantidad.toLocaleString("es-VE")}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{fmtFechaHora(c.ultima)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-3 py-1.5"><h2 className="text-[13px] font-semibold">Trazabilidad: movimientos del lote ({traza.length})</h2></div>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Movimiento</TableHead><TableHead>Contacto</TableHead><TableHead>Origen → Destino</TableHead><TableHead>Fecha</TableHead><TableHead className="text-right">Cantidad</TableHead><TableHead>Estado</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {traza.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Sin movimientos registrados</TableCell></TableRow>
            ) : traza.map((f) => (
              <TableRow key={f.key} className={f.link ? "cursor-pointer hover:bg-muted/50" : ""} onClick={() => f.link && navigate(f.link)}>
                <TableCell className={f.link ? "font-mono text-sm text-primary" : "text-sm font-medium"}>
                  {f.titulo}<span className="block font-sans text-xs font-normal text-muted-foreground">{f.subtitulo}</span>
                </TableCell>
                <TableCell className="max-w-[200px] truncate">{f.contacto}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <span className="block max-w-[240px] truncate">{f.origen}</span>
                  <span className="block max-w-[240px] truncate">→ {f.destino}</span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{fmtFechaHora(f.fecha)}</TableCell>
                <TableCell className="text-right font-semibold">{f.cantidad.toLocaleString("es-VE")}</TableCell>
                <TableCell>{f.estado}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </MainLayout>
  );
};

export default LoteDetalle;
