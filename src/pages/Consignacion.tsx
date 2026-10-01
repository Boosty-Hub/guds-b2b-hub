import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Boxes, FileText } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { BarraLista } from "@/components/datos/BarraLista";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, coincide, enRango, contadorFiltrado,
} from "@/components/datos/FiltrosLista";

interface Item { id: string; nombre_producto: string | null; sku_producto: string | null; cantidad: number; precio_unitario: number; subtotal: number; }
interface Declaracion {
  id: string; numero: string; estado: string; fecha: string; subtotal: number; impuesto: number; total: number;
  notas: string | null; rol_declarante: string; factura_id: string | null;
  cliente_id?: string | null; almacen_id?: string | null; empresa_id?: string | null;
  cliente?: { nombre_negocio: string } | null;
  almacen?: { nombre: string } | null;
  factura?: { numero: string } | null;
}

const ROL: Record<string, string> = { cliente: "Cliente", vendedor: "Vendedor", admin: "Administración" };
const TABS = ["pendientes", "aprobadas", "rechazadas"];

const ESTADO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  aprobado: { label: "Aprobado", variant: "default" },
  rechazado: { label: "Rechazado", variant: "destructive" },
};

const Consignacion = () => {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const [declaraciones, setDeclaraciones] = useState<Declaracion[]>([]);
  const [loading, setLoading] = useState(true);
  const [detalle, setDetalle] = useState<Declaracion | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [params, setParams] = useSearchParams();
  // Pestaña (estado de la declaración) en la URL para que los filtros sobrevivan a recargar
  const tab = TABS.includes(params.get("tab") ?? "") ? params.get("tab")! : "pendientes";
  const setTab = (t: string) => setParams((p) => { const n = new URLSearchParams(p); if (t === "pendientes") n.delete("tab"); else n.set("tab", t); return n; }, { replace: true });

  const fetchAll = async () => {
    setLoading(true);
    const { data } = await supabase.from("declaraciones_consignacion")
      .select("id, numero, estado, fecha, subtotal, impuesto, total, notas, rol_declarante, factura_id, cliente_id, almacen_id, empresa_id, cliente:clientes(nombre_negocio), almacen:almacenes(nombre), factura:facturas(numero)")
      .order("created_at", { ascending: false });
    setDeclaraciones((data as unknown as Declaracion[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  // ---- Filtros (en la URL): valen para las tres pestañas ----
  const filtroEmpresa = useFiltroEmpresa(declaraciones);
  const f = useFiltros([
    { clave: "cliente", etiqueta: "Cliente", todos: "Todos los clientes", principal: true, opciones: opcionesDe(declaraciones, (d) => d.cliente_id, (d) => d.cliente?.nombre_negocio ?? "—") },
    { clave: "almacen", etiqueta: "Almacén", todos: "Todos los almacenes", principal: true, opciones: opcionesDe(declaraciones, (d) => d.almacen_id, (d) => d.almacen?.nombre ?? "—") },
    { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", principal: true },
    { clave: "declarante", etiqueta: "Declarado por", todos: "Todos", opciones: opcionesDe(declaraciones, (d) => d.rol_declarante, (_d, v) => ROL[v] ?? v) },
    filtroEmpresa,
  ]);
  const termino = q.trim().toLowerCase();
  const filtradas = declaraciones.filter((d) =>
    coincide(d.cliente_id, f.v("cliente")) && coincide(d.almacen_id, f.v("almacen")) && enRango(d.fecha, f.v("fecha"))
    && coincide(d.rol_declarante, f.v("declarante")) && (!filtroEmpresa || coincide(d.empresa_id, f.v("empresa")))
    && (!termino || d.numero.toLowerCase().includes(termino) || (d.cliente?.nombre_negocio || "").toLowerCase().includes(termino)));
  const pendientes = filtradas.filter((d) => d.estado === "pendiente");
  const aprobadas = filtradas.filter((d) => d.estado === "aprobado");
  const rechazadas = filtradas.filter((d) => d.estado === "rechazado");
  const deTab = tab === "aprobadas" ? aprobadas : tab === "rechazadas" ? rechazadas : pendientes;
  const totalTab = declaraciones.filter((d) => d.estado === (tab === "aprobadas" ? "aprobado" : tab === "rechazadas" ? "rechazado" : "pendiente")).length;

  const pgPend = usePagination(pendientes, 50, f.firma);
  const pgApr = usePagination(aprobadas, 50, f.firma);
  const pgRech = usePagination(rechazadas, 50, f.firma);

  const abrirDetalle = async (d: Declaracion) => {
    setDetalle(d);
    setNotas("");
    const { data } = await supabase.from("declaracion_consignacion_items").select("id, nombre_producto, sku_producto, cantidad, precio_unitario, subtotal").eq("declaracion_id", d.id);
    setItems((data as Item[]) ?? []);
  };

  const revisar = async (aprobar: boolean) => {
    if (!detalle) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("revisar_declaracion_consignacion", {
      p_declaracion_id: detalle.id, p_aprobar: aprobar, p_notas: notas || null,
    });
    setSaving(false);
    if (error) { toast({ title: "No se pudo procesar", description: error.message, variant: "destructive" }); return; }
    const r = data as { numero?: string };
    toast({
      title: aprobar ? "Declaración aprobada" : "Declaración rechazada",
      description: aprobar ? `Factura ${r.numero} generada` : "Se descartó la declaración.",
    });
    setDetalle(null);
    fetchAll();
  };

  const renderTabla = (rows: Declaracion[], pg: ReturnType<typeof usePagination<Declaracion>>, accionable: boolean) => (
    <div className="rounded-lg border border-border bg-card">
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{f.activos || termino ? "Ninguna declaración coincide con la búsqueda o los filtros." : "Sin declaraciones en esta categoría."}</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Almacén</TableHead>
                <TableHead>Declarado por</TableHead><TableHead>Fecha</TableHead>
                <TableHead className="text-right">Total</TableHead>
                {accionable ? <TableHead className="text-right">Acción</TableHead> : <TableHead>Factura</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pg.pageItems.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{d.numero}</TableCell>
                  <TableCell className="max-w-[260px] truncate font-medium" title={d.cliente?.nombre_negocio || undefined}>{d.cliente?.nombre_negocio || "—"}</TableCell>
                  <TableCell className="max-w-[220px] truncate text-muted-foreground" title={d.almacen?.nombre || undefined}>{d.almacen?.nombre || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{ROL[d.rol_declarante] ?? d.rol_declarante}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(d.fecha).toLocaleDateString("es-VE")}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(d.total)}</TableCell>
                  {accionable ? (
                    <TableCell className="text-right"><Button size="sm" className="h-7 px-2.5" onClick={() => abrirDetalle(d)}>Revisar</Button></TableCell>
                  ) : (
                    <TableCell className="whitespace-nowrap">
                      {d.factura?.numero ? (
                        <Link to={`/admin/facturas/${d.factura_id}`} className="flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                          <FileText className="h-3.5 w-3.5" /> {d.factura.numero}
                        </Link>
                      ) : "—"}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DataTablePagination pagination={pg} />
        </>
      )}
    </div>
  );

  return (
    <MainLayout title="Consignación">
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <BarraLista
            pestanas={
              <TabsList className="h-auto flex-wrap justify-start">
                <TabsTrigger value="pendientes" className="gap-1.5"><Boxes className="h-3.5 w-3.5" /> Pendientes ({pendientes.length})</TabsTrigger>
                <TabsTrigger value="aprobadas">Aprobadas ({aprobadas.length})</TabsTrigger>
                <TabsTrigger value="rechazadas">Rechazadas ({rechazadas.length})</TabsTrigger>
              </TabsList>
            }
            busqueda={q}
            onBusqueda={setQ}
            placeholder="Buscar número o cliente..."
            filtros={<FiltrosLista filtros={f} resultados={deTab.length} />}
            contador={contadorFiltrado(deTab.length, totalTab, f.activos || !!termino)}
          />
          <TabsContent value="pendientes">{renderTabla(pendientes, pgPend, true)}</TabsContent>
          <TabsContent value="aprobadas">{renderTabla(aprobadas, pgApr, false)}</TabsContent>
          <TabsContent value="rechazadas">{renderTabla(rechazadas, pgRech, false)}</TabsContent>
        </Tabs>
      )}

      <Dialog open={!!detalle} onOpenChange={(o) => !o && setDetalle(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Declaración {detalle?.numero}</DialogTitle></DialogHeader>
          {detalle && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
                <div><span className="text-muted-foreground">Cliente:</span> <span className="font-medium">{detalle.cliente?.nombre_negocio}</span></div>
                <div><span className="text-muted-foreground">Almacén:</span> {detalle.almacen?.nombre}</div>
                <div><span className="text-muted-foreground">Declarado por:</span> <span className="capitalize">{detalle.rol_declarante}</span></div>
                <div><span className="text-muted-foreground">Fecha:</span> {new Date(detalle.fecha).toLocaleDateString("es-VE")}</div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Producto</TableHead><TableHead className="text-center">Cant.</TableHead><TableHead className="text-right">Precio</TableHead><TableHead className="text-right">Subtotal</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-medium">{it.nombre_producto}</TableCell>
                      <TableCell className="text-center">{it.cantidad}</TableCell>
                      <TableCell className="text-right">{formatPrice(it.precio_unitario)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatPrice(it.subtotal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-end gap-6 text-sm">
                <span>Subtotal: <span className="font-semibold">{formatPrice(detalle.subtotal)}</span></span>
                <span>IVA: <span className="font-semibold">{formatPrice(detalle.impuesto)}</span></span>
                <span>Total: <span className="font-semibold text-primary">{formatPrice(detalle.total)}</span></span>
              </div>
              {detalle.notas && <p className="text-sm text-muted-foreground">Notas del declarante: {detalle.notas}</p>}
              <Textarea rows={2} placeholder="Notas de la revisión (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="destructive" onClick={() => revisar(false)} disabled={saving}>Rechazar</Button>
            <Button onClick={() => revisar(true)} disabled={saving} className="gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Aprobar y facturar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Consignacion;
