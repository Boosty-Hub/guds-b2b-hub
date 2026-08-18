import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeft, Loader2, Users, Edit } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface Vendedor { id: string; nombre: string; apellido: string | null; email: string; telefono: string | null; activo: boolean; }
interface ClienteRow { id: string; nombre_negocio: string; codigo: string | null; saldo: number; }

const VendedorDetalle = () => {
  const { vendedorId } = useParams();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const [vendedor, setVendedor] = useState<Vendedor | null>(null);
  const [clientes, setClientes] = useState<ClienteRow[]>([]);
  const [otrosVendedores, setOtrosVendedores] = useState<Vendedor[]>([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ nombre: "", apellido: "", telefono: "" });

  const cargar = async () => {
    setLoading(true);
    const [{ data: v }, { data: vends }] = await Promise.all([
      supabase.from("usuarios").select("id, nombre, apellido, email, telefono, activo").eq("id", vendedorId).maybeSingle(),
      supabase.from("usuarios").select("id, nombre, apellido, email, telefono, activo").eq("role", "vendedor").order("nombre"),
    ]);
    setVendedor((v as Vendedor) ?? null);
    setOtrosVendedores(((vends as Vendedor[]) ?? []).filter((x) => x.id !== vendedorId));
    if (v) setForm({ nombre: v.nombre, apellido: v.apellido || "", telefono: v.telefono || "" });

    const { data: clis } = await supabase.from("clientes").select("id, nombre_negocio, codigo").eq("vendedor_asignado_id", vendedorId).eq("activo", true).order("nombre_negocio");
    const ids = (clis ?? []).map((c: { id: string }) => c.id);
    const saldoMap: Record<string, number> = {};
    if (ids.length) {
      const { data: facs } = await supabase.from("facturas").select("cliente_id, saldo_usd").in("cliente_id", ids).eq("estado", "posted");
      for (const f of (facs as { cliente_id: string; saldo_usd: number }[]) ?? []) {
        saldoMap[f.cliente_id] = (saldoMap[f.cliente_id] || 0) + Number(f.saldo_usd);
      }
    }
    setClientes(((clis as { id: string; nombre_negocio: string; codigo: string | null }[]) ?? []).map((c) => ({ ...c, saldo: saldoMap[c.id] || 0 })));
    setLoading(false);
  };
  useEffect(() => { cargar(); }, [vendedorId]);

  const pagination = usePagination(clientes, 25);
  const totalSaldo = clientes.reduce((s, c) => s + c.saldo, 0);

  const reasignar = async (clienteId: string, nuevoVendedorId: string | null) => {
    const { error } = await supabase.from("clientes").update({ vendedor_asignado_id: nuevoVendedorId }).eq("id", clienteId);
    if (error) { toast({ title: "No se pudo reasignar", description: error.message, variant: "destructive" }); return; }
    toast({ title: nuevoVendedorId ? "Cliente reasignado" : "Cliente sin vendedor" });
    cargar();
  };

  const guardarEdicion = async () => {
    if (!vendedor) return;
    const { error } = await supabase.from("usuarios").update({ nombre: form.nombre, apellido: form.apellido || null, telefono: form.telefono || null }).eq("id", vendedor.id);
    if (error) { toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Vendedor actualizado" });
    setEditOpen(false);
    cargar();
  };

  const toggleActivo = async () => {
    if (!vendedor) return;
    const { error } = await supabase.from("usuarios").update({ activo: !vendedor.activo }).eq("id", vendedor.id);
    if (error) { toast({ title: "No se pudo cambiar el estado", description: error.message, variant: "destructive" }); return; }
    cargar();
  };

  const volver = (
    <Button variant="ghost" className="mb-4 gap-2" onClick={() => navigate("/admin/vendedores")}>
      <ArrowLeft className="h-4 w-4" /> Volver a vendedores
    </Button>
  );

  if (loading) return <MainLayout title="Vendedor">{volver}<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></MainLayout>;
  if (!vendedor) return <MainLayout title="Vendedor">{volver}<div className="flex flex-col items-center py-20 text-muted-foreground"><Users className="mb-4 h-12 w-12 opacity-50" /><p>Vendedor no encontrado</p></div></MainLayout>;

  const iniciales = vendedor.nombre.split(" ").map((w) => w[0]).join("").slice(0, 2);

  return (
    <MainLayout title={vendedor.nombre}>
      {volver}

      <div className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14"><AvatarFallback className="bg-primary/10 text-lg text-primary">{iniciales}</AvatarFallback></Avatar>
          <div>
            <h1 className="text-xl font-bold">{vendedor.nombre} {vendedor.apellido || ""}</h1>
            <p className="text-sm text-muted-foreground">{vendedor.email}{vendedor.telefono ? ` · ${vendedor.telefono}` : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2"><span className="text-sm text-muted-foreground">Activo</span><Switch checked={vendedor.activo} onCheckedChange={toggleActivo} /></div>
          <Button variant="outline" className="gap-2" onClick={() => setEditOpen(true)}><Edit className="h-4 w-4" /> Editar</Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
          <h2 className="font-semibold">Clientes asignados ({clientes.length})</h2>
          <p className="text-sm text-muted-foreground">Saldo total: <span className="font-semibold text-foreground">{formatPrice(totalSaldo)}</span></p>
        </div>
        {clientes.length === 0 ? (
          <p className="p-8 text-center text-muted-foreground">Sin clientes asignados.</p>
        ) : (
          <>
            <Table>
              <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead className="text-right">Saldo</TableHead><TableHead className="w-56">Reasignar a</TableHead></TableRow></TableHeader>
              <TableBody>
                {pagination.pageItems.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell><p className="font-medium">{c.nombre_negocio}</p><p className="text-xs text-muted-foreground">{c.codigo}</p></TableCell>
                    <TableCell className={`text-right font-semibold ${c.saldo > 0.009 ? "text-destructive" : ""}`}>{formatPrice(c.saldo)}</TableCell>
                    <TableCell>
                      <Select onValueChange={(v) => reasignar(c.id, v === "sin-asignar" ? null : v)}>
                        <SelectTrigger><SelectValue placeholder="Elegir vendedor..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sin-asignar">Sin asignar</SelectItem>
                          {otrosVendedores.map((v) => <SelectItem key={v.id} value={v.id}>{v.nombre} {v.apellido || ""}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pagination} />
          </>
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Editar vendedor</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Nombre</Label><Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
              <div className="space-y-2"><Label>Apellido</Label><Input value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Teléfono</Label><Input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
            <Button onClick={guardarEdicion}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default VendedorDetalle;
