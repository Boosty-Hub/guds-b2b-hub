import { Fragment, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Loader2, Warehouse, Boxes, ChevronRight, ArrowLeftRight, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { OdooBadge } from "@/components/OdooBadge";
import { VencimientoBadge, estadoVencimiento } from "@/components/inventario/VencimientoBadge";
import { AsignarClienteConsignacion } from "@/components/inventario/AsignarClienteConsignacion";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useToast } from "@/hooks/use-toast";

interface AlmacenFull {
  id: string;
  nombre: string;
  codigo: string | null;
  tipo: "propio" | "consignacion";
  activo: boolean;
  odoo_id: number | null;
  vinculo_cliente: "nombre" | "entregas" | "manual" | null;
  cliente?: { id: string; nombre_negocio: string } | null;
}
interface InvRow {
  cantidad: number;
  reservado: number;
  producto?: { id: string; nombre: string; sku: string; unidad: string } | null;
}
interface LoteRow {
  id: string; ubicacion: string | null; cantidad: number; reservado: number; producto_id: string;
  lote?: { id: string; nombre: string; vencimiento: string | null; es_serie: boolean } | null;
}
const VINCULO: Record<string, string> = {
  nombre: "identificado por el nombre del almacén",
  entregas: "identificado por las entregas de este almacén en Odoo",
  manual: "asignado manualmente en GUDS",
};

const nf = (n: number) => n.toLocaleString("es-VE");

const AlmacenDetalle = () => {
  const { almacenId } = useParams();
  const navigate = useNavigate();
  const [almacen, setAlmacen] = useState<AlmacenFull | null>(null);
  const [inv, setInv] = useState<InvRow[]>([]);
  const [lotes, setLotes] = useState<LoteRow[]>([]);
  const [pendientes, setPendientes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const alternar = (id: string) => setAbiertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const { can } = usePermissions();
  const { toast } = useToast();
  const [asignando, setAsignando] = useState(false);
  const [version, setVersion] = useState(0);
  const volverAutomatico = async () => {
    const { error } = await supabase.from("almacenes").update({ vinculo_cliente: null }).eq("id", almacenId);
    if (error) { toast({ title: "No se pudo cambiar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Vínculo automático", description: "En la próxima sincronización el cliente se identificará desde Odoo." });
    setVersion((v) => v + 1);
  };

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true);
      const [{ data: a }, { data: rows }, { data: ls }, { count }] = await Promise.all([
        supabase.from("almacenes").select("id, nombre, codigo, tipo, activo, odoo_id, vinculo_cliente, cliente:clientes(id, nombre_negocio)").eq("id", almacenId).maybeSingle(),
        supabase.from("inventario_almacen").select("cantidad, reservado, producto:productos(id, nombre, sku, unidad)").eq("almacen_id", almacenId).order("cantidad", { ascending: false }),
        supabase.from("inventario_lotes").select("id, ubicacion, cantidad, reservado, producto_id, lote:lotes(id, nombre, vencimiento, es_serie)").eq("almacen_id", almacenId),
        supabase.from("transferencias").select("id", { count: "exact", head: true })
          .or(`almacen_origen_id.eq.${almacenId},almacen_destino_id.eq.${almacenId}`).in("estado", ["borrador", "en_espera", "parcial", "lista"]),
      ]);
      if (vivo) {
        setAlmacen((a as unknown as AlmacenFull) ?? null);
        setInv((rows as unknown as InvRow[]) ?? []);
        setLotes((ls as unknown as LoteRow[]) ?? []);
        setPendientes(count ?? 0);
        setLoading(false);
      }
    })();
    return () => { vivo = false; };
  }, [almacenId, version]);

  const lotesPorProducto = useMemo(() => {
    const m = new Map<string, LoteRow[]>();
    for (const l of lotes) {
      if (!m.has(l.producto_id)) m.set(l.producto_id, []);
      m.get(l.producto_id)!.push(l);
    }
    for (const arr of m.values()) arr.sort((x, y) => (x.lote?.vencimiento || "9999").localeCompare(y.lote?.vencimiento || "9999"));
    return m;
  }, [lotes]);
  const filtrado = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return inv;
    return inv.filter((r) => [r.producto?.nombre, r.producto?.sku].some((v) => (v || "").toLowerCase().includes(t))
      || (lotesPorProducto.get(r.producto?.id || "") || []).some((l) => (l.lote?.nombre || "").toLowerCase().includes(t)));
  }, [inv, q, lotesPorProducto]);
  const pg = usePagination(filtrado, 50);

  const volver = (
    <Button variant="ghost" size="sm" className="mb-2 h-7 gap-1.5 px-2 text-xs" onClick={() => navigate(-1)}>
      <ArrowLeft className="h-3.5 w-3.5" /> Volver
    </Button>
  );

  if (loading) {
    return <MainLayout title="Almacén">{volver}<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></MainLayout>;
  }
  if (!almacen) {
    return <MainLayout title="Almacén">{volver}<div className="py-20 text-center text-muted-foreground">Almacén no encontrado</div></MainLayout>;
  }

  const totalUnidades = inv.reduce((s, r) => s + Number(r.cantidad || 0), 0);
  const totalReservado = inv.reduce((s, r) => s + Number(r.reservado || 0), 0);
  const vencidos = lotes.filter((l) => Number(l.cantidad) > 0 && estadoVencimiento(l.lote?.vencimiento) === "vencido").length;
  const porVencer = lotes.filter((l) => Number(l.cantidad) > 0 && ["30", "90"].includes(estadoVencimiento(l.lote?.vencimiento))).length;

  return (
    <MainLayout title={almacen.nombre}>
      {volver}

      {/* Encabezado */}
      <div className="mb-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="rounded-md bg-primary/10 p-1.5"><Warehouse className="h-4 w-4 text-primary" /></div>
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-2 text-base font-semibold">{almacen.nombre}{almacen.odoo_id && <OdooBadge />}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {almacen.codigo && <span className="font-mono text-sm text-muted-foreground">{almacen.codigo}</span>}
                <Badge variant={almacen.tipo === "consignacion" ? "outline" : "default"}>
                  {almacen.tipo === "consignacion" ? "Consignación" : "Propio"}
                </Badge>
                <Badge variant={almacen.activo ? "default" : "secondary"}>{almacen.activo ? "Activo" : "Inactivo"}</Badge>
              </div>
              {almacen.tipo === "consignacion" && (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  {almacen.cliente ? (
                    <span>Cliente: <Link to={`/admin/clientes/${almacen.cliente.id}`} className="font-medium text-primary hover:underline">{almacen.cliente.nombre_negocio}</Link>
                      {almacen.vinculo_cliente && <span className="text-muted-foreground"> · {VINCULO[almacen.vinculo_cliente]}</span>}</span>
                  ) : (
                    <span className="text-muted-foreground">{almacen.vinculo_cliente === "manual" ? "Sin cliente (confirmado manualmente)" : "Sin cliente identificado en Odoo"}</span>
                  )}
                  {can("inventario", "editar") && (
                    <>
                      <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setAsignando(true)}>{almacen.cliente ? "Cambiar" : "Asignar cliente"}</Button>
                      {almacen.vinculo_cliente === "manual" && <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground" onClick={volverAutomatico}>Volver a automático</Button>}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => navigate(`/admin/transferencias?almacen=${almacen.id}&tipo=todas&estado=todas`)}>
            <ArrowLeftRight className="h-4 w-4" /> Movimientos{pendientes > 0 && <Badge variant="secondary">{pendientes} pendientes</Badge>}
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-4 border-t border-border pt-3 lg:grid-cols-5">
          <div><p className="text-xs text-muted-foreground">Productos</p><p className="text-base font-semibold">{inv.length}</p></div>
          <div><p className="text-xs text-muted-foreground">Unidades</p><p className="text-base font-semibold">{nf(totalUnidades)}</p></div>
          <div><p className="text-xs text-muted-foreground">Reservado para despachos</p><p className="text-base font-semibold">{nf(totalReservado)}</p></div>
          <div><p className="text-xs text-muted-foreground">Lotes vencen en 90 días</p><p className="text-base font-semibold">{porVencer}</p></div>
          <div><p className="text-xs text-muted-foreground">Lotes vencidos con existencia</p><p className={cn("text-base font-semibold", vencidos > 0 && "text-destructive")}>{vencidos}</p></div>
        </div>
      </div>

      <div className="mb-4 relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar producto, SKU o lote..." className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {/* Inventario por producto, con sus lotes */}
      <div className="rounded-lg border border-border bg-card">
        {inv.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Boxes className="mb-3 h-10 w-10 opacity-50" />
            <p>Este almacén no tiene existencias.</p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto / lote</TableHead>
                  <TableHead>Unidad</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead className="text-right">Reservado</TableHead>
                  <TableHead>Vencimiento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pg.pageItems.map((r, i) => {
                  const pid = r.producto?.id || String(i);
                  const ls = lotesPorProducto.get(pid) || [];
                  const abierto = abiertos.has(pid) || (!!q.trim() && ls.some((l) => (l.lote?.nombre || "").toLowerCase().includes(q.trim().toLowerCase())));
                  const proximo = ls.find((l) => l.lote?.vencimiento)?.lote?.vencimiento ?? null;
                  return (
                    <Fragment key={pid}>
                      <TableRow className={cn(ls.length > 0 && "cursor-pointer", "hover:bg-muted/50")} onClick={() => ls.length > 0 && alternar(pid)}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-2">
                            {ls.length > 0 ? <ChevronRight className={cn("h-4 w-4 shrink-0 transition-transform", abierto && "rotate-90")} /> : <span className="w-4" />}
                            <span>
                              {r.producto?.nombre || "Producto"}
                              <span className="block font-mono text-xs font-normal text-muted-foreground">{r.producto?.sku}{ls.length > 0 && ` · ${ls.length} lote${ls.length !== 1 ? "s" : ""}`}</span>
                            </span>
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{r.producto?.unidad || "—"}</TableCell>
                        <TableCell className="text-right font-semibold">{nf(Number(r.cantidad))}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{Number(r.reservado) > 0 ? nf(Number(r.reservado)) : "—"}</TableCell>
                        <TableCell>{proximo && <VencimientoBadge vencimiento={proximo} />}</TableCell>
                      </TableRow>
                      {abierto && ls.map((l) => (
                        <TableRow key={l.id} className="bg-muted/20">
                          <TableCell className="pl-12 font-mono text-sm">
                            {l.lote ? <Link to={`/admin/lotes/${l.lote.id}`} className="text-primary hover:underline">{l.lote.nombre}</Link> : "Sin lote"}
                            {l.lote?.es_serie && <Badge variant="outline" className="ml-2 px-1 py-0 font-sans text-[10px]">Serie</Badge>}
                            {l.ubicacion && <span className="block font-sans text-xs text-muted-foreground">{l.ubicacion}</span>}
                          </TableCell>
                          <TableCell />
                          <TableCell className="text-right text-sm">{nf(Number(l.cantidad))}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">{Number(l.reservado) > 0 ? nf(Number(l.reservado)) : "—"}</TableCell>
                          <TableCell>{l.lote && <VencimientoBadge vencimiento={l.lote.vencimiento} conFecha />}</TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pg} />
          </>
        )}
      </div>
      {almacen.tipo === "consignacion" && (
        <AsignarClienteConsignacion almacenId={almacen.id} clienteActual={almacen.cliente?.id ?? null} abierto={asignando}
          onCerrar={() => setAsignando(false)} onGuardado={() => setVersion((v) => v + 1)} />
      )}
    </MainLayout>
  );
};

export default AlmacenDetalle;
