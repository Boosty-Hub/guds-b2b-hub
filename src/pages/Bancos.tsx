import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Plus, Landmark, Loader2, Pencil, Trash2, ArrowDownLeft, ArrowUpRight, Receipt } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface Banco {
  id: string;
  nombre: string;
  metodo_pago: string;
  moneda: string;
  numero_cuenta: string | null;
  titular: string | null;
  documento: string | null;
  activo: boolean;
  metodos: string[] | null;
  saldo?: number;
}

interface Movimiento { id: string; tipo: string; monto: number; referencia: string | null; descripcion: string | null; fecha: string; }

const metodoLabel: Record<string, string> = {
  transferencia: "Transferencia", efectivo: "Efectivo", pago_movil: "Pago Móvil", credito: "Crédito", tarjeta: "Tarjeta",
};

const METODOS = [
  { tipo: "transferencia", label: "Transferencia" },
  { tipo: "pago_movil", label: "Pago Móvil" },
  { tipo: "tarjeta", label: "Tarjeta" },
  { tipo: "efectivo", label: "Efectivo" },
];

const fmtMoneda = (n: number, moneda: string) =>
  moneda === "USD"
    ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `Bs. ${n.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const emptyForm = { nombre: "", metodos: ["transferencia"], moneda: "USD", numero_cuenta: "", titular: "", documento: "", activo: true };

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

  const [movSheet, setMovSheet] = useState<Banco | null>(null);
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [movsLoading, setMovsLoading] = useState(false);

  const fetchBancos = async () => {
    setLoading(true);
    const [{ data, error }, { data: mv }] = await Promise.all([
      supabase.from("bancos").select("*").order("nombre"),
      supabase.from("movimientos_bancarios").select("banco_id, tipo, monto"),
    ]);
    if (error) { toast({ title: "Error al cargar bancos", description: error.message, variant: "destructive" }); setLoading(false); return; }
    const saldo = new Map<string, number>();
    for (const m of (mv as { banco_id: string; tipo: string; monto: number }[]) ?? []) {
      saldo.set(m.banco_id, (saldo.get(m.banco_id) || 0) + (m.tipo === "salida" ? -Number(m.monto) : Number(m.monto)));
    }
    setBancos(((data || []) as Banco[]).map((b) => ({ ...b, saldo: saldo.get(b.id) || 0 })));
    setLoading(false);
  };

  const openMovs = async (b: Banco) => {
    setMovSheet(b); setMovsLoading(true); setMovs([]);
    const { data } = await supabase.from("movimientos_bancarios")
      .select("id, tipo, monto, referencia, descripcion, fecha").eq("banco_id", b.id).order("fecha", { ascending: false });
    setMovs((data as Movimiento[]) ?? []);
    setMovsLoading(false);
  };

  const openNew = () => { setEditing(null); setForm({ ...emptyForm }); setFormOpen(true); };
  const openEdit = (b: Banco) => {
    setEditing(b);
    setForm({
      nombre: b.nombre, metodos: b.metodos && b.metodos.length ? b.metodos : [b.metodo_pago], moneda: b.moneda,
      numero_cuenta: b.numero_cuenta || "", titular: b.titular || "", documento: b.documento || "", activo: b.activo,
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.nombre.trim()) { toast({ title: "Falta el nombre", variant: "destructive" }); return; }
    if (form.metodos.length === 0) { toast({ title: "Elegí al menos un método de pago", variant: "destructive" }); return; }
    setSaving(true);
    const payload = {
      nombre: form.nombre.trim(), metodo_pago: form.metodos[0], metodos: form.metodos, moneda: form.moneda,
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

  const pagination = usePagination(bancos, 25);

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
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead>Titular</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pagination.pageItems.map((b) => (
                <TableRow key={b.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openMovs(b)}>
                  <TableCell><p className="font-medium">{b.nombre}</p><p className="text-xs text-muted-foreground font-mono">{b.numero_cuenta || "—"}</p></TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(b.metodos && b.metodos.length ? b.metodos : [b.metodo_pago]).map((m) => (
                        <Badge key={m} variant="outline" className="text-xs font-normal">{metodoLabel[m] || m}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={b.moneda === "USD" ? "default" : "secondary"}>{b.moneda === "USD" ? "USD $" : "Bs."}</Badge></TableCell>
                  <TableCell className="text-right font-semibold">{fmtMoneda(b.saldo || 0, b.moneda)}</TableCell>
                  <TableCell className="text-muted-foreground">{b.titular || "—"}</TableCell>
                  <TableCell><Badge variant={b.activo ? "default" : "outline"}>{b.activo ? "Activo" : "Inactivo"}</Badge></TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
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
        {!loading && <DataTablePagination pagination={pagination} />}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar banco" : "Nuevo banco"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2"><Label>Nombre del banco / cuenta</Label>
              <Input value={form.nombre} onChange={(e) => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. Banco Mercantil / Zelle" /></div>
            <div className="col-span-2"><Label>Métodos de pago que recibe</Label>
              <div className="mt-1 grid grid-cols-2 gap-2 rounded-lg border p-3 sm:grid-cols-4">
                {METODOS.map((m) => (
                  <label key={m.tipo} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={form.metodos.includes(m.tipo)}
                      onCheckedChange={(ck) => setForm(f => ({
                        ...f,
                        metodos: ck ? [...f.metodos, m.tipo] : f.metodos.filter(x => x !== m.tipo),
                      }))}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>
            <div className="col-span-2"><Label>Moneda</Label>
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

      {/* Movimientos del banco */}
      <Sheet open={!!movSheet} onOpenChange={(o) => { if (!o) setMovSheet(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:w-[50vw] sm:max-w-none">
          <SheetHeader><SheetTitle>Movimientos — {movSheet?.nombre}</SheetTitle></SheetHeader>
          {movSheet && (
            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between rounded-xl border bg-muted/40 p-4">
                <span className="text-sm text-muted-foreground">Saldo actual</span>
                <span className="text-xl font-bold">{fmtMoneda(movSheet.saldo || 0, movSheet.moneda)}</span>
              </div>
              {movsLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : movs.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-muted-foreground"><Receipt className="mb-2 h-8 w-8 opacity-50" />Sin movimientos todavía.</div>
              ) : (
                <div className="rounded-xl border">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Fecha</TableHead><TableHead>Descripción</TableHead>
                      <TableHead>Referencia</TableHead><TableHead className="text-right">Monto</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {movs.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="text-muted-foreground">{new Date(m.fecha).toLocaleDateString("es-VE")}</TableCell>
                          <TableCell className="font-medium">
                            {m.tipo === "salida"
                              ? <ArrowUpRight className="mr-1 inline h-4 w-4 text-destructive" />
                              : <ArrowDownLeft className="mr-1 inline h-4 w-4 text-success" />}
                            {m.descripcion || (m.tipo === "salida" ? "Salida" : "Entrada")}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">{m.referencia || "—"}</TableCell>
                          <TableCell className={`text-right font-semibold ${m.tipo === "salida" ? "text-destructive" : "text-success"}`}>
                            {m.tipo === "salida" ? "-" : "+"}{fmtMoneda(Number(m.monto), movSheet.moneda)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </MainLayout>
  );
};

export default Bancos;
