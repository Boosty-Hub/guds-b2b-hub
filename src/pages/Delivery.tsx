import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, Loader2, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { DetalleEntregaDialog, type EntregaDetalle } from "@/components/delivery/DetalleEntregaDialog";
import { fechaCorta } from "@/components/delivery/fechas";

interface Repartidor { id: string; nombre: string; apellido: string | null; }
interface Orden {
  id: string; numero: string; total: number; estado: string; direccion_entrega: string | null;
  cliente?: { nombre_negocio: string; direccion: string; ciudad: string } | null;
}
interface Entrega extends EntregaDetalle {
  orden_id: string | null;
  orden?: { numero: string; total: number; cliente?: { nombre_negocio: string; direccion: string } | null } | null;
}

const estadoConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  asignada: { label: "Asignada", variant: "outline" },
  en_camino: { label: "En Camino", variant: "default" },
  entregada: { label: "Entregada", variant: "secondary" },
  fallida: { label: "Fallida", variant: "destructive" },
};

const Delivery = () => {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const [repartidores, setRepartidores] = useState<Repartidor[]>([]);
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  // Estado del despacho en Odoo (transferencia de entrega de cada orden)
  const [despacho, setDespacho] = useState<Record<string, { estado: string; numero: string }>>({});
  const [soloListas, setSoloListas] = useState(false);
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [loading, setLoading] = useState(true);
  const [asignarOrden, setAsignarOrden] = useState<Orden | null>(null);
  const [repSel, setRepSel] = useState("");
  const [prioridad, setPrioridad] = useState("normal");
  const [saving, setSaving] = useState(false);
  const [detalle, setDetalle] = useState<Entrega | null>(null);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [rRes, oRes, eRes] = await Promise.all([
      supabase.from("usuarios").select("id, nombre, apellido").eq("role", "delivery").eq("activo", true),
      supabase.from("ordenes").select("id, numero, total, estado, direccion_entrega, cliente:clientes(nombre_negocio, direccion, ciudad)").in("estado", ["confirmado", "procesando", "enviado"]).order("created_at", { ascending: false }),
      supabase.from("entregas").select("id, orden_id, estado, prioridad, fecha_asignacion, fecha_inicio_entrega, fecha_entrega, receptor_nombre, notas, motivo_fallo, firma_url, foto_entrega_url, orden:ordenes(numero, total, cliente:clientes(nombre_negocio, direccion)), repartidor:usuarios!entregas_repartidor_id_fkey(nombre, apellido)").order("fecha_asignacion", { ascending: false }),
    ]);
    if (rRes.data) setRepartidores(rRes.data as Repartidor[]);
    if (eRes.data) setEntregas(eRes.data as unknown as Entrega[]);
    // Órdenes que ya tienen una entrega activa (no fallida) — se excluyen de "por asignar". Por id y no por número:
    // los números se repiten entre empresas (S00360 existe en GUDS y en Quirutec).
    const ordenesConEntrega = new Set(
      ((eRes.data || []) as unknown as { estado: string; orden_id: string | null }[]).filter((e) => e.estado !== "fallida" && e.orden_id).map((e) => e.orden_id)
    );
    const pendientes = ((oRes.data as unknown as Orden[]) ?? []).filter((o) => !ordenesConEntrega.has(o.id));
    setOrdenes(pendientes);
    if (pendientes.length) {
      const { data: tr } = await supabase.from("transferencias").select("orden_id, estado, numero").eq("tipo", "entrega")
        .in("orden_id", pendientes.map((o) => o.id)).neq("estado", "cancelada");
      // Por orden, la transferencia más relevante: lista > en espera/parcial > hecha
      const peso: Record<string, number> = { lista: 3, parcial: 2, en_espera: 2, borrador: 1, hecha: 0 };
      const m: Record<string, { estado: string; numero: string }> = {};
      for (const t of (tr as { orden_id: string; estado: string; numero: string }[] | null) ?? []) {
        if (!m[t.orden_id] || (peso[t.estado] ?? 0) > (peso[m[t.orden_id].estado] ?? 0)) m[t.orden_id] = { estado: t.estado, numero: t.numero };
      }
      setDespacho(m);
    }
    setLoading(false);
  };

  const asignar = async () => {
    if (!asignarOrden || !repSel) return;
    setSaving(true);
    const { error } = await supabase.rpc("asignar_entrega", {
      p_orden_id: asignarOrden.id, p_repartidor_id: repSel, p_prioridad: prioridad,
    });
    setSaving(false);
    if (error) { toast({ title: "No se pudo asignar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Entrega asignada", description: `${asignarOrden.numero} asignada al repartidor` });
    setAsignarOrden(null); setRepSel(""); setPrioridad("normal");
    fetchAll();
  };

  const total = entregas.length;
  const asignadas = entregas.filter((e) => e.estado === "asignada").length;
  const enCamino = entregas.filter((e) => e.estado === "en_camino").length;
  const entregadas = entregas.filter((e) => e.estado === "entregada").length;
  const fmt = fechaCorta;

  const ordenesVista = soloListas ? ordenes.filter((o) => despacho[o.id]?.estado === "lista") : ordenes;
  const pagination = usePagination(ordenesVista, 50);
  const DESPACHO: Record<string, { label: string; cls: string }> = {
    lista: { label: "Lista para despachar", cls: "border-primary/40 bg-primary/10 text-primary" },
    en_espera: { label: "Esperando stock", cls: "border-warning/60 bg-warning/15" },
    parcial: { label: "Parcialmente disponible", cls: "border-warning/60 bg-warning/15" },
    borrador: { label: "Borrador en Odoo", cls: "text-muted-foreground" },
    hecha: { label: "Despachada en Odoo", cls: "border-success/40 bg-success/10 text-success" },
  };
  const pagination2 = usePagination(entregas, 50);

  const [tab, setTab] = useState<string>("por-asignar");
  const pestanas = (
    <TabsList>
      <TabsTrigger value="por-asignar">Por asignar ({ordenes.length})</TabsTrigger>
      <TabsTrigger value="entregas">Envíos ({entregas.length})</TabsTrigger>
    </TabsList>
  );

  return (
    <MainLayout title="Gestión de Envíos">
      <KpiStrip
        items={[
          { label: "Total Envíos", valor: total, tono: "primario" },
          { label: "Asignados", valor: asignadas },
          { label: "En Ruta", valor: enCamino, tono: "alerta" },
          { label: "Entregados", valor: entregadas, tono: "positivo" },
        ]}
      />

      <Tabs value={tab} onValueChange={setTab}>
        {/* Pestañas, búsqueda, filtros y acciones de la pestaña activa en una sola fila */}
        {tab === "por-asignar" ? (
          <BarraLista
            pestanas={pestanas}
            filtros={
              <label className="flex cursor-pointer items-center gap-2 text-[13px]">
                <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={soloListas} onChange={(e) => setSoloListas(e.target.checked)} />
                Solo las listas para despachar en Odoo ({ordenes.filter((o) => despacho[o.id]?.estado === "lista").length})
              </label>
            }
            contador={loading ? undefined : `${ordenesVista.length} registros`}
          />
        ) : (
          <BarraLista pestanas={pestanas} contador={loading ? undefined : `${entregas.length} registros`} />
        )}

        <TabsContent value="por-asignar">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            : ordenes.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No hay órdenes listas para asignar a delivery</div>
            : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Orden</TableHead><TableHead>Cliente</TableHead><TableHead>Dirección</TableHead>
                  <TableHead className="text-right">Total</TableHead><TableHead>Estado</TableHead><TableHead>Despacho (Odoo)</TableHead><TableHead className="text-right">Acción</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {pagination.pageItems.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="whitespace-nowrap font-medium text-primary">{o.numero}</TableCell>
                      <TableCell>
                        <span className="block max-w-[260px] truncate" title={o.cliente?.nombre_negocio || undefined}>{o.cliente?.nombre_negocio || "—"}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="block max-w-[240px] truncate" title={o.cliente?.direccion || o.direccion_entrega || undefined}>{o.cliente?.direccion || o.direccion_entrega || "—"}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(Number(o.total))}</TableCell>
                      <TableCell className="whitespace-nowrap"><Badge variant="secondary" className="capitalize">{o.estado}</Badge></TableCell>
                      <TableCell>
                        {despacho[o.id] ? (
                          <span className="flex items-center gap-1.5 whitespace-nowrap">
                            <Badge variant="outline" className={`whitespace-nowrap font-normal ${DESPACHO[despacho[o.id].estado]?.cls ?? ""}`}>{DESPACHO[despacho[o.id].estado]?.label ?? despacho[o.id].estado}</Badge>
                            <span className="font-mono text-xs text-muted-foreground">{despacho[o.id].numero}</span>
                          </span>
                        ) : <span className="whitespace-nowrap text-xs text-muted-foreground">Sin transferencia</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => { setAsignarOrden(o); setRepSel(""); setPrioridad("normal"); }}>
                          <UserPlus className="h-3.5 w-3.5" />Asignar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {!loading && <DataTablePagination pagination={pagination} />}
          </div>
        </TabsContent>

        <TabsContent value="entregas">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            : entregas.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Aún no hay envíos</div>
            : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Orden</TableHead><TableHead>Cliente</TableHead><TableHead>Repartidor</TableHead>
                  <TableHead>Asignada</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Detalle</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {pagination2.pageItems.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap font-medium text-primary">{e.orden?.numero || "—"}</TableCell>
                      <TableCell>
                        <span className="block max-w-[260px] truncate" title={e.orden?.cliente?.nombre_negocio || undefined}>{e.orden?.cliente?.nombre_negocio || "—"}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{e.repartidor ? `${e.repartidor.nombre} ${e.repartidor.apellido || ""}` : "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmt(e.fecha_asignacion)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(Number(e.orden?.total || 0))}</TableCell>
                      <TableCell className="whitespace-nowrap"><Badge variant={estadoConfig[e.estado]?.variant || "outline"}>{estadoConfig[e.estado]?.label || e.estado}</Badge></TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => setDetalle(e)}
                          title={e.estado === "entregada" ? "Ver firma y foto de la entrega" : "Ver detalle del envío"}>
                          <Eye className="h-3.5 w-3.5" />{e.estado === "entregada" ? "Evidencia" : "Ver"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {!loading && <DataTablePagination pagination={pagination2} />}
          </div>
        </TabsContent>
      </Tabs>

      <DetalleEntregaDialog entrega={detalle} onClose={() => setDetalle(null)} />

      {/* Asignar repartidor */}
      <Dialog open={!!asignarOrden} onOpenChange={(o) => { if (!o) setAsignarOrden(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Asignar envío — {asignarOrden?.numero}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">{asignarOrden?.cliente?.nombre_negocio} · {asignarOrden?.cliente?.direccion || asignarOrden?.direccion_entrega}</p>
            <div>
              <Label>Repartidor</Label>
              <Select value={repSel} onValueChange={setRepSel}>
                <SelectTrigger><SelectValue placeholder="Selecciona un repartidor" /></SelectTrigger>
                <SelectContent>
                  {repartidores.length === 0 && <div className="px-2 py-1.5 text-sm text-muted-foreground">No hay repartidores activos</div>}
                  {repartidores.map((r) => <SelectItem key={r.id} value={r.id}>{r.nombre} {r.apellido || ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Prioridad</Label>
              <Select value={prioridad} onValueChange={setPrioridad}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsignarOrden(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={asignar} disabled={saving || !repSel}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Asignar envío"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Delivery;
