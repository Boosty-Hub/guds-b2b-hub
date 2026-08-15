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
import { Truck, Package, Clock, CheckCircle, Loader2, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface Repartidor { id: string; nombre: string; apellido: string | null; }
interface Orden {
  id: string; numero: string; total: number; estado: string; direccion_entrega: string | null;
  cliente?: { nombre_negocio: string; direccion: string; ciudad: string } | null;
}
interface Entrega {
  id: string; estado: string; prioridad: string | null; fecha_asignacion: string | null;
  orden?: { numero: string; total: number; cliente?: { nombre_negocio: string; direccion: string } | null } | null;
  repartidor?: { nombre: string; apellido: string | null } | null;
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
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [loading, setLoading] = useState(true);
  const [asignarOrden, setAsignarOrden] = useState<Orden | null>(null);
  const [repSel, setRepSel] = useState("");
  const [prioridad, setPrioridad] = useState("normal");
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [rRes, oRes, eRes] = await Promise.all([
      supabase.from("usuarios").select("id, nombre, apellido").eq("role", "delivery").eq("activo", true),
      supabase.from("ordenes").select("id, numero, total, estado, direccion_entrega, cliente:clientes(nombre_negocio, direccion, ciudad)").in("estado", ["confirmado", "procesando", "enviado"]).order("created_at", { ascending: false }),
      supabase.from("entregas").select("id, estado, prioridad, fecha_asignacion, orden:ordenes(numero, total, cliente:clientes(nombre_negocio, direccion)), repartidor:usuarios!entregas_repartidor_id_fkey(nombre, apellido)").order("fecha_asignacion", { ascending: false }),
    ]);
    if (rRes.data) setRepartidores(rRes.data as Repartidor[]);
    if (eRes.data) setEntregas(eRes.data as unknown as Entrega[]);
    // Órdenes que ya tienen una entrega activa (no fallida) — se excluyen de "por asignar"
    const activeOrdenNums = new Set(
      (eRes.data || []).filter((e: { estado: string }) => e.estado !== "fallida").map((e: { orden?: { numero: string } | null }) => e.orden?.numero)
    );
    if (oRes.data) setOrdenes((oRes.data as unknown as Orden[]).filter((o) => !activeOrdenNums.has(o.numero)));
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
  const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : "—");

  const pagination = usePagination(ordenes, 25);
  const pagination2 = usePagination(entregas, 25);

  const stat = (icon: React.ReactNode, n: number, label: string, cls: string) => (
    <div className="rounded-lg border border-border bg-card p-4"><div className="flex items-center gap-3">
      <div className={`rounded-lg p-2 ${cls}`}>{icon}</div>
      <div><p className="text-2xl font-bold">{n}</p><p className="text-sm text-muted-foreground">{label}</p></div>
    </div></div>
  );

  return (
    <MainLayout title="Gestión de Envíos">
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        {stat(<Package className="h-5 w-5 text-primary" />, total, "Total Envíos", "bg-primary/10")}
        {stat(<Clock className="h-5 w-5 text-muted-foreground" />, asignadas, "Asignados", "bg-muted")}
        {stat(<Truck className="h-5 w-5 text-amber-600" />, enCamino, "En Ruta", "bg-amber-500/10")}
        {stat(<CheckCircle className="h-5 w-5 text-green-600" />, entregadas, "Entregados", "bg-green-500/10")}
      </div>

      <Tabs defaultValue="por-asignar" className="space-y-4">
        <TabsList>
          <TabsTrigger value="por-asignar">Por asignar ({ordenes.length})</TabsTrigger>
          <TabsTrigger value="entregas">Envíos ({entregas.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="por-asignar">
          <div className="rounded-xl border border-border bg-card">
            {loading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            : ordenes.length === 0 ? <div className="py-16 text-center text-muted-foreground">No hay órdenes listas para asignar a delivery</div>
            : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Orden</TableHead><TableHead>Cliente</TableHead><TableHead>Dirección</TableHead>
                  <TableHead className="text-right">Total</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acción</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {pagination.pageItems.map((o) => (
                    <TableRow key={o.id} className="hover:bg-muted/50">
                      <TableCell className="font-medium text-primary">{o.numero}</TableCell>
                      <TableCell>{o.cliente?.nombre_negocio || "—"}</TableCell>
                      <TableCell className="text-muted-foreground max-w-[220px] truncate">{o.cliente?.direccion || o.direccion_entrega || "—"}</TableCell>
                      <TableCell className="text-right font-semibold">{formatPrice(Number(o.total))}</TableCell>
                      <TableCell><Badge variant="secondary" className="capitalize">{o.estado}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => { setAsignarOrden(o); setRepSel(""); setPrioridad("normal"); }}>
                          <UserPlus className="h-4 w-4 mr-1" />Asignar
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
          <div className="rounded-xl border border-border bg-card">
            {loading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            : entregas.length === 0 ? <div className="py-16 text-center text-muted-foreground">Aún no hay envíos</div>
            : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Orden</TableHead><TableHead>Cliente</TableHead><TableHead>Repartidor</TableHead>
                  <TableHead>Asignada</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Estado</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {pagination2.pageItems.map((e) => (
                    <TableRow key={e.id} className="hover:bg-muted/50">
                      <TableCell className="font-medium text-primary">{e.orden?.numero || "—"}</TableCell>
                      <TableCell>{e.orden?.cliente?.nombre_negocio || "—"}</TableCell>
                      <TableCell>{e.repartidor ? `${e.repartidor.nombre} ${e.repartidor.apellido || ""}` : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{fmt(e.fecha_asignacion)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatPrice(Number(e.orden?.total || 0))}</TableCell>
                      <TableCell><Badge variant={estadoConfig[e.estado]?.variant || "outline"}>{estadoConfig[e.estado]?.label || e.estado}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {!loading && <DataTablePagination pagination={pagination2} />}
          </div>
        </TabsContent>
      </Tabs>

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
