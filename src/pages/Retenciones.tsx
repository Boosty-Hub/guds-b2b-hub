import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Receipt, Eye, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { DeclararRetencionForm } from "@/components/retenciones/DeclararRetencionForm";
import type { FacturaSaldo } from "@/components/cuentas/SelectorFacturas";
import { OdooBadge } from "@/components/OdooBadge";
import { BarraLista } from "@/components/datos/BarraLista";

interface Retencion {
  id: string; numero: string; tipo: string; estado: string; fecha: string; total: number;
  base_imponible: number; porcentaje: number | null; comprobante_url: string | null; notas: string | null;
  rol_declarante: string; odoo_id: number | null;
  cliente?: { nombre_negocio: string } | null;
  concepto?: { concepto: string } | null;
}
interface ItemRow { id: string; monto_aplicado: number; factura?: { numero: string; saldo_usd: number } | null; }
interface ClienteLite { id: string; nombre_negocio: string; }

const ESTADO: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  aprobado: { label: "Aprobado", variant: "default" },
  rechazado: { label: "Rechazado", variant: "destructive" },
};

const Retenciones = () => {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const [retenciones, setRetenciones] = useState<Retencion[]>([]);
  const [loading, setLoading] = useState(true);
  const [detalle, setDetalle] = useState<Retencion | null>(null);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);

  const [openNueva, setOpenNueva] = useState(false);
  const [clientes, setClientes] = useState<ClienteLite[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [facturasCliente, setFacturasCliente] = useState<FacturaSaldo[]>([]);

  const fetchAll = async () => {
    setLoading(true);
    // Incluye tanto las declaradas en el sistema como las migradas de Odoo (odoo_id no
    // nulo) — antes se excluían las migradas y el módulo mostraba 0 aunque hubiera
    // histórico real de retenciones de clientes.
    const { data } = await supabase.from("retenciones")
      .select("id, numero, tipo, estado, fecha, total, base_imponible, porcentaje, comprobante_url, notas, rol_declarante, odoo_id, cliente:clientes(nombre_negocio), concepto:conceptos_retencion_islr(concepto)")
      .order("created_at", { ascending: false });
    setRetenciones((data as unknown as Retencion[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  const pendientes = retenciones.filter((r) => r.estado === "pendiente");
  const aprobadas = retenciones.filter((r) => r.estado === "aprobado");
  const rechazadas = retenciones.filter((r) => r.estado === "rechazado");
  const pgPend = usePagination(pendientes, 50);
  const pgApr = usePagination(aprobadas, 50);
  const pgRech = usePagination(rechazadas, 50);

  const abrirDetalle = async (r: Retencion) => {
    setDetalle(r);
    setNotas("");
    const { data } = await supabase.from("retencion_items").select("id, monto_aplicado, factura:facturas(numero, saldo_usd)").eq("retencion_id", r.id);
    setItems((data as unknown as ItemRow[]) ?? []);
  };

  const revisar = async (aprobar: boolean) => {
    if (!detalle) return;
    setSaving(true);
    const { error } = await supabase.rpc("revisar_retencion", { p_retencion_id: detalle.id, p_aprobar: aprobar, p_notas: notas || null });
    setSaving(false);
    if (error) { toast({ title: "No se pudo procesar", description: error.message, variant: "destructive" }); return; }
    toast({ title: aprobar ? "Retención aprobada" : "Retención rechazada" });
    setDetalle(null);
    fetchAll();
  };

  const verComprobante = async (path: string) => {
    const { data, error } = await supabase.storage.from("documentos").createSignedUrl(path, 120);
    if (error || !data?.signedUrl) { toast({ title: "No se pudo abrir el comprobante", variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const abrirNueva = async () => {
    setClienteId(""); setFacturasCliente([]);
    if (clientes.length === 0) {
      const { data } = await supabase.from("clientes").select("id, nombre_negocio").or("retiene_iva.eq.true,retiene_islr.eq.true").order("nombre_negocio");
      setClientes((data as ClienteLite[]) ?? []);
    }
    setOpenNueva(true);
  };

  const elegirClienteNueva = async (cid: string) => {
    setClienteId(cid);
    const { data } = await supabase.from("facturas")
      .select("id, numero, fecha_emision, saldo_usd")
      .eq("cliente_id", cid).eq("tipo", "factura").eq("estado", "posted").gt("saldo_usd", 0.009)
      .order("fecha_emision", { ascending: true });
    setFacturasCliente(((data as { id: string; numero: string; fecha_emision: string | null; saldo_usd: number }[]) ?? [])
      .map((f) => ({ id: f.id, numero: f.numero, fecha_emision: f.fecha_emision, saldo_usd: Number(f.saldo_usd) })));
  };

  const renderTabla = (rows: Retencion[], pg: ReturnType<typeof usePagination<Retencion>>, accionable: boolean) => (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Sin retenciones en esta categoría.</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nº</TableHead><TableHead>Cliente</TableHead><TableHead>Tipo</TableHead>
                <TableHead>Declarado por</TableHead><TableHead>Origen</TableHead><TableHead>Fecha</TableHead>
                <TableHead className="text-right">Total</TableHead>
                {accionable && <TableHead className="text-right">Acción</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pg.pageItems.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{r.numero}</TableCell>
                  <TableCell className="font-medium">
                    <span className="block max-w-[260px] truncate" title={r.cliente?.nombre_negocio || undefined}>{r.cliente?.nombre_negocio || "—"}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap uppercase text-muted-foreground">{r.tipo}</TableCell>
                  <TableCell className="whitespace-nowrap capitalize text-muted-foreground">{r.rol_declarante}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.odoo_id ? <OdooBadge /> : <Badge variant="outline" className="px-1 py-0 text-[10px]">GUDS</Badge>}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(r.fecha).toLocaleDateString("es-VE")}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(r.total)}</TableCell>
                  {accionable && (
                    <TableCell className="whitespace-nowrap text-right">
                      <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => abrirDetalle(r)}>Revisar</Button>
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
    <MainLayout title="Retenciones">
      {/* Pestañas, contador y acciones en una sola fila */}
      <Tabs defaultValue="pendientes">
        <BarraLista
          pestanas={
            <TabsList>
              <TabsTrigger value="pendientes" className="gap-1.5"><Receipt className="h-3.5 w-3.5" /> Pendientes ({pendientes.length})</TabsTrigger>
              <TabsTrigger value="aprobadas">Aprobadas ({aprobadas.length})</TabsTrigger>
              <TabsTrigger value="rechazadas">Rechazadas ({rechazadas.length})</TabsTrigger>
            </TabsList>
          }
          contador={loading ? undefined : `${retenciones.length} registros`}
          acciones={<Button size="sm" className="gap-1.5" onClick={abrirNueva}><Plus className="h-3.5 w-3.5" /> Registrar retención</Button>}
        />
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <>
            <TabsContent value="pendientes">{renderTabla(pendientes, pgPend, true)}</TabsContent>
            <TabsContent value="aprobadas">{renderTabla(aprobadas, pgApr, false)}</TabsContent>
            <TabsContent value="rechazadas">{renderTabla(rechazadas, pgRech, false)}</TabsContent>
          </>
        )}
      </Tabs>

      {/* Revisar */}
      <Dialog open={!!detalle} onOpenChange={(o) => !o && setDetalle(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Retención {detalle?.numero}</DialogTitle></DialogHeader>
          {detalle && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
                <div><span className="text-muted-foreground">Cliente:</span> <span className="font-medium">{detalle.cliente?.nombre_negocio}</span></div>
                <div><span className="text-muted-foreground">Tipo:</span> <span className="uppercase">{detalle.tipo}</span></div>
                {detalle.concepto && <div className="col-span-2"><span className="text-muted-foreground">Concepto:</span> {detalle.concepto.concepto} ({detalle.porcentaje}%)</div>}
                <div><span className="text-muted-foreground">Fecha:</span> {new Date(detalle.fecha).toLocaleDateString("es-VE")}</div>
                <div><span className="text-muted-foreground">Declarado por:</span> <span className="capitalize">{detalle.rol_declarante}</span></div>
              </div>
              {detalle.comprobante_url && (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => verComprobante(detalle.comprobante_url!)}>
                  <Eye className="h-4 w-4" /> Ver comprobante
                </Button>
              )}
              <Table>
                <TableHeader><TableRow><TableHead>Factura</TableHead><TableHead className="text-right">Saldo</TableHead><TableHead className="text-right">Retenido</TableHead></TableRow></TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-mono text-sm text-primary">{it.factura?.numero}</TableCell>
                      <TableCell className="text-right">{formatPrice(it.factura?.saldo_usd ?? 0)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatPrice(it.monto_aplicado)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-end text-sm">Total: <span className="ml-2 font-semibold text-primary">{formatPrice(detalle.total)}</span></div>
              {detalle.notas && <p className="text-sm text-muted-foreground">Notas: {detalle.notas}</p>}
              <Textarea rows={2} placeholder="Notas de la revisión (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} />
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="destructive" onClick={() => revisar(false)} disabled={saving}>Rechazar</Button>
            <Button onClick={() => revisar(true)} disabled={saving} className="gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Aprobar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Registrar nueva (admin, directo) */}
      <Dialog open={openNueva} onOpenChange={setOpenNueva}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Registrar Retención</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Select value={clienteId} onValueChange={elegirClienteNueva}>
                <SelectTrigger><SelectValue placeholder="Elegir cliente" /></SelectTrigger>
                <SelectContent>
                  {clientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nombre_negocio}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {clienteId && (
              <DeclararRetencionForm
                clienteId={clienteId}
                facturas={facturasCliente}
                permiteComprobante={false}
                onDeclarado={() => { setOpenNueva(false); fetchAll(); }}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Retenciones;
