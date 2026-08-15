import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Ticket, Percent, DollarSign, Loader2, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface Cupon {
  id: string;
  codigo: string;
  descripcion: string | null;
  tipo: string; // 'porcentaje' | 'fijo'
  valor: number;
  minimo_compra: number;
  maximo_descuento: number | null;
  usos_maximos: number | null;
  usos_actuales: number;
  usos_por_cliente: number;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  activo: boolean;
  solo_primera_compra: boolean;
}

const emptyForm = {
  codigo: "", descripcion: "", tipo: "porcentaje", valor: "", minimo_compra: "0",
  maximo_descuento: "", usos_maximos: "", usos_por_cliente: "1",
  fecha_inicio: "", fecha_fin: "", activo: true, solo_primera_compra: false,
};

const Cupones = () => {
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const [cupones, setCupones] = useState<Cupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Cupon | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Cupon | null>(null);

  useEffect(() => { fetchCupones(); }, []);

  const fetchCupones = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("cupones").select("*").order("created_at", { ascending: false });
    if (error) toast({ title: "Error al cargar cupones", description: error.message, variant: "destructive" });
    else setCupones((data || []) as Cupon[]);
    setLoading(false);
  };

  const hoy = new Date().toISOString().slice(0, 10);
  const vigente = (c: Cupon) => c.activo && (!c.fecha_inicio || c.fecha_inicio <= hoy) && (!c.fecha_fin || c.fecha_fin >= hoy);
  const vencido = (c: Cupon) => !!c.fecha_fin && c.fecha_fin < hoy;

  const activos = cupones.filter(vigente).length;
  const totalUsos = cupones.reduce((s, c) => s + Number(c.usos_actuales || 0), 0);
  const vencidos = cupones.filter(vencido).length;

  const openNew = () => { setEditing(null); setForm({ ...emptyForm }); setFormOpen(true); };
  const openEdit = (c: Cupon) => {
    setEditing(c);
    setForm({
      codigo: c.codigo, descripcion: c.descripcion || "", tipo: c.tipo, valor: String(c.valor),
      minimo_compra: String(c.minimo_compra ?? 0), maximo_descuento: c.maximo_descuento != null ? String(c.maximo_descuento) : "",
      usos_maximos: c.usos_maximos != null ? String(c.usos_maximos) : "", usos_por_cliente: String(c.usos_por_cliente ?? 1),
      fecha_inicio: c.fecha_inicio || "", fecha_fin: c.fecha_fin || "", activo: c.activo, solo_primera_compra: c.solo_primera_compra,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.codigo.trim() || !form.valor || Number(form.valor) <= 0) {
      toast({ title: "Datos incompletos", description: "Código y un valor mayor que 0 son obligatorios", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      codigo: form.codigo.trim().toUpperCase(),
      descripcion: form.descripcion || null,
      tipo: form.tipo,
      valor: Number(form.valor),
      minimo_compra: Number(form.minimo_compra) || 0,
      maximo_descuento: form.maximo_descuento ? Number(form.maximo_descuento) : null,
      usos_maximos: form.usos_maximos ? Number(form.usos_maximos) : null,
      usos_por_cliente: Number(form.usos_por_cliente) || 1,
      fecha_inicio: form.fecha_inicio || null,
      fecha_fin: form.fecha_fin || null,
      activo: form.activo,
      solo_primera_compra: form.solo_primera_compra,
    };
    const { error } = editing
      ? await supabase.from("cupones").update(payload).eq("id", editing.id)
      : await supabase.from("cupones").insert(payload);
    setSaving(false);
    if (error) {
      toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: editing ? "Cupón actualizado" : "Cupón creado", description: `${payload.codigo} guardado correctamente` });
    setFormOpen(false);
    fetchCupones();
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const { error } = await supabase.from("cupones").delete().eq("id", toDelete.id);
    if (error) toast({ title: "No se pudo eliminar", description: error.message, variant: "destructive" });
    else { toast({ title: "Cupón eliminado", description: `${toDelete.codigo} fue eliminado` }); fetchCupones(); }
    setToDelete(null);
  };

  const filtrados = cupones.filter((c) =>
    c.codigo.toLowerCase().includes(search.toLowerCase()) || (c.descripcion || "").toLowerCase().includes(search.toLowerCase()));

  const pagination = usePagination(filtrados, 25);

  const estadoBadge = (c: Cupon) => {
    if (vencido(c)) return <Badge variant="secondary">Vencido</Badge>;
    if (!c.activo) return <Badge variant="outline">Inactivo</Badge>;
    if (c.usos_maximos != null && c.usos_actuales >= c.usos_maximos) return <Badge variant="secondary">Agotado</Badge>;
    return <Badge variant="default">Activo</Badge>;
  };

  return (
    <MainLayout title="Cupones y Descuentos">
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2"><Ticket className="h-5 w-5 text-primary" /></div>
            <div><p className="text-2xl font-bold">{activos}</p><p className="text-sm text-muted-foreground">Cupones activos</p></div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success/10 p-2"><Percent className="h-5 w-5 text-success" /></div>
            <div><p className="text-2xl font-bold">{totalUsos}</p><p className="text-sm text-muted-foreground">Usos totales</p></div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2"><DollarSign className="h-5 w-5 text-warning" /></div>
            <div><p className="text-2xl font-bold">{vencidos}</p><p className="text-sm text-muted-foreground">Cupones vencidos</p></div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar cupón..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button className="gap-2" onClick={openNew}><Plus className="h-4 w-4" /> Nuevo Cupón</Button>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : filtrados.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">No hay cupones. Crea el primero con "Nuevo Cupón".</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">Mín. compra</TableHead>
                <TableHead className="text-center">Usos</TableHead>
                <TableHead>Vigencia</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.pageItems.map((c) => (
                <TableRow key={c.id} className="hover:bg-muted/50">
                  <TableCell className="font-mono font-medium text-primary">{c.codigo}</TableCell>
                  <TableCell className="text-muted-foreground max-w-[200px] truncate">{c.descripcion || "—"}</TableCell>
                  <TableCell className="capitalize">{c.tipo}</TableCell>
                  <TableCell className="text-right font-semibold">{c.tipo === "porcentaje" ? `${c.valor}%` : formatPrice(Number(c.valor))}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{Number(c.minimo_compra) > 0 ? formatPrice(Number(c.minimo_compra)) : "—"}</TableCell>
                  <TableCell className="text-center tabular-nums">{c.usos_actuales}{c.usos_maximos != null ? ` / ${c.usos_maximos}` : ""}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{c.fecha_fin ? `hasta ${c.fecha_fin}` : "sin vencimiento"}</TableCell>
                  <TableCell>{estadoBadge(c)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setToDelete(c)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!loading && <DataTablePagination pagination={pagination} />}
      </div>

      {/* Form */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Editar cupón" : "Nuevo cupón"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2">
              <Label>Código</Label>
              <Input value={form.codigo} onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value.toUpperCase() }))} placeholder="BIENVENIDO20" />
            </div>
            <div className="col-span-2">
              <Label>Descripción</Label>
              <Input value={form.descripcion} onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))} placeholder="Descuento de bienvenida" />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={(v) => setForm((f) => ({ ...f, tipo: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="porcentaje">Porcentaje (%)</SelectItem>
                  <SelectItem value="fijo">Monto fijo ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor</Label>
              <Input type="number" min="0" step="0.01" value={form.valor} onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))} placeholder={form.tipo === "porcentaje" ? "20" : "50.00"} />
            </div>
            <div>
              <Label>Mínimo de compra</Label>
              <Input type="number" min="0" step="0.01" value={form.minimo_compra} onChange={(e) => setForm((f) => ({ ...f, minimo_compra: e.target.value }))} />
            </div>
            <div>
              <Label>Descuento máximo</Label>
              <Input type="number" min="0" step="0.01" value={form.maximo_descuento} onChange={(e) => setForm((f) => ({ ...f, maximo_descuento: e.target.value }))} placeholder="sin tope" />
            </div>
            <div>
              <Label>Usos máximos</Label>
              <Input type="number" min="0" value={form.usos_maximos} onChange={(e) => setForm((f) => ({ ...f, usos_maximos: e.target.value }))} placeholder="ilimitado" />
            </div>
            <div>
              <Label>Usos por cliente</Label>
              <Input type="number" min="1" value={form.usos_por_cliente} onChange={(e) => setForm((f) => ({ ...f, usos_por_cliente: e.target.value }))} />
            </div>
            <div>
              <Label>Fecha inicio</Label>
              <Input type="date" value={form.fecha_inicio} onChange={(e) => setForm((f) => ({ ...f, fecha_inicio: e.target.value }))} />
            </div>
            <div>
              <Label>Fecha fin</Label>
              <Input type="date" value={form.fecha_fin} onChange={(e) => setForm((f) => ({ ...f, fecha_fin: e.target.value }))} />
            </div>
            <div className="flex items-center justify-between col-span-2 rounded-lg border border-border p-3">
              <Label className="cursor-pointer">Activo</Label>
              <Switch checked={form.activo} onCheckedChange={(v) => setForm((f) => ({ ...f, activo: v }))} />
            </div>
            <div className="flex items-center justify-between col-span-2 rounded-lg border border-border p-3">
              <Label className="cursor-pointer">Solo primera compra</Label>
              <Switch checked={form.solo_primera_compra} onCheckedChange={(v) => setForm((f) => ({ ...f, solo_primera_compra: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Guardar cambios" : "Crear cupón"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar el cupón {toDelete?.codigo}?</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
};

export default Cupones;
