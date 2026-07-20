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
import { Plus, Landmark, Loader2, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

interface Banco {
  id: string;
  nombre: string;
  metodo_pago: string;
  moneda: string;
  numero_cuenta: string | null;
  titular: string | null;
  documento: string | null;
  activo: boolean;
}

const metodoLabel: Record<string, string> = {
  transferencia: "Transferencia", efectivo: "Efectivo", pago_movil: "Pago Móvil", credito: "Crédito",
};

const emptyForm = { nombre: "", metodo_pago: "transferencia", moneda: "USD", numero_cuenta: "", titular: "", documento: "", activo: true };

const Bancos = () => {
  const { toast } = useToast();
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Banco | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Banco | null>(null);

  useEffect(() => { fetchBancos(); }, []);

  const fetchBancos = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("bancos").select("*").order("nombre");
    if (error) toast({ title: "Error al cargar bancos", description: error.message, variant: "destructive" });
    else setBancos((data || []) as Banco[]);
    setLoading(false);
  };

  const openNew = () => { setEditing(null); setForm({ ...emptyForm }); setFormOpen(true); };
  const openEdit = (b: Banco) => {
    setEditing(b);
    setForm({
      nombre: b.nombre, metodo_pago: b.metodo_pago, moneda: b.moneda,
      numero_cuenta: b.numero_cuenta || "", titular: b.titular || "", documento: b.documento || "", activo: b.activo,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.nombre.trim()) { toast({ title: "Falta el nombre", variant: "destructive" }); return; }
    setSaving(true);
    const payload = {
      nombre: form.nombre.trim(), metodo_pago: form.metodo_pago, moneda: form.moneda,
      numero_cuenta: form.numero_cuenta || null, titular: form.titular || null, documento: form.documento || null, activo: form.activo,
    };
    const { error } = editing
      ? await supabase.from("bancos").update(payload).eq("id", editing.id)
      : await supabase.from("bancos").insert(payload);
    setSaving(false);
    if (error) { toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" }); return; }
    toast({ title: editing ? "Banco actualizado" : "Banco creado", description: `${payload.nombre} guardado` });
    setFormOpen(false);
    fetchBancos();
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    const { error } = await supabase.from("bancos").delete().eq("id", toDelete.id);
    if (error) toast({ title: "No se pudo eliminar", description: error.message, variant: "destructive" });
    else { toast({ title: "Banco eliminado", description: toDelete.nombre }); fetchBancos(); }
    setToDelete(null);
  };

  return (
    <MainLayout title="Bancos">
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2"><Landmark className="h-5 w-5 text-primary" /></div>
          <div><p className="text-2xl font-bold">{bancos.length}</p><p className="text-sm text-muted-foreground">Cuentas bancarias</p></div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-2xl font-bold">{bancos.filter(b => b.moneda === "USD").length}</p><p className="text-sm text-muted-foreground">En dólares</p></div>
        <div className="rounded-lg border border-border bg-card p-4"><p className="text-2xl font-bold">{bancos.filter(b => b.moneda === "BS").length}</p><p className="text-sm text-muted-foreground">En bolívares</p></div>
      </div>

      <div className="flex justify-between items-center mb-4">
        <div><h2 className="text-lg font-semibold">Cuentas para recibir pagos</h2><p className="text-sm text-muted-foreground">Se eligen al registrar un cobro; en bolívares se pide la tasa de cambio.</p></div>
        <Button className="gap-2" onClick={openNew}><Plus className="h-4 w-4" /> Nuevo Banco</Button>
      </div>

      <div className="rounded-xl border border-border bg-card">
        {loading ? <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        : bancos.length === 0 ? <div className="py-16 text-center text-muted-foreground">No hay cuentas bancarias. Crea la primera con "Nuevo Banco".</div>
        : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Banco / Cuenta</TableHead><TableHead>Método</TableHead><TableHead>Moneda</TableHead>
              <TableHead>Titular</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {bancos.map((b) => (
                <TableRow key={b.id} className="hover:bg-muted/50">
                  <TableCell><p className="font-medium">{b.nombre}</p><p className="text-xs text-muted-foreground font-mono">{b.numero_cuenta || "—"}</p></TableCell>
                  <TableCell>{metodoLabel[b.metodo_pago] || b.metodo_pago}</TableCell>
                  <TableCell><Badge variant={b.moneda === "USD" ? "default" : "secondary"}>{b.moneda === "USD" ? "USD $" : "Bs."}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{b.titular || "—"}</TableCell>
                  <TableCell><Badge variant={b.activo ? "default" : "outline"}>{b.activo ? "Activo" : "Inactivo"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(b)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setToDelete(b)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar banco" : "Nuevo banco"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2"><Label>Nombre del banco / cuenta</Label>
              <Input value={form.nombre} onChange={(e) => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. Banco Mercantil / Zelle" /></div>
            <div><Label>Método de pago</Label>
              <Select value={form.metodo_pago} onValueChange={(v) => setForm(f => ({ ...f, metodo_pago: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="transferencia">Transferencia</SelectItem>
                  <SelectItem value="pago_movil">Pago Móvil</SelectItem>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Moneda</Label>
              <Select value={form.moneda} onValueChange={(v) => setForm(f => ({ ...f, moneda: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">Dólares (USD)</SelectItem>
                  <SelectItem value="BS">Bolívares (Bs.)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><Label>Número de cuenta / identificador</Label>
              <Input value={form.numero_cuenta} onChange={(e) => setForm(f => ({ ...f, numero_cuenta: e.target.value }))} placeholder="0105-… o correo Zelle" /></div>
            <div><Label>Titular</Label>
              <Input value={form.titular} onChange={(e) => setForm(f => ({ ...f, titular: e.target.value }))} /></div>
            <div><Label>Documento (RIF/Cédula)</Label>
              <Input value={form.documento} onChange={(e) => setForm(f => ({ ...f, documento: e.target.value }))} /></div>
            <div className="flex items-center justify-between col-span-2 rounded-lg border border-border p-3">
              <Label className="cursor-pointer">Activo</Label>
              <Switch checked={form.activo} onCheckedChange={(v) => setForm(f => ({ ...f, activo: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Guardar" : "Crear banco"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => { if (!o) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {toDelete?.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>Los pagos ya registrados con este banco se conservan.</AlertDialogDescription>
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

export default Bancos;
