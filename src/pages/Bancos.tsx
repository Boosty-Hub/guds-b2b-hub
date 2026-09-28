import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
import { Plus, Loader2, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { OdooBadge } from "@/components/OdooBadge";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";

interface Banco {
  odoo_id?: number | null;
  id: string;
  nombre: string;
  metodo_pago: string;
  moneda: string;
  numero_cuenta: string | null;
  titular: string | null;
  documento: string | null;
  activo: boolean;
  metodos: string[] | null;
  banco_nombre?: string | null;
  visible_portal?: boolean;
  pago_movil_telefono?: string | null;
  pago_movil_documento?: string | null;
  pago_movil_banco?: string | null;
  zelle_correo?: string | null;
  zelle_titular?: string | null;
  instrucciones?: string | null;
  saldo_odoo?: number | null;
  saldo_extracto?: number | null;
  cuenta_compartida?: boolean;
  cuenta_odoo?: string | null;
  saldo?: number;
  porConciliar?: number;
}
interface PorIdentificar { id: string; monto: number; referencia: string | null; descripcion: string | null; fecha: string; banco?: { id: string; nombre: string; moneda: string } | null }

// Saldo que se muestra: el contable de Odoo; si el diario comparte cuenta con otro, el del extracto; en bancos propios de GUDS, sus movimientos
const saldoDe = (b: Banco) => (b.odoo_id ? Number((b.cuenta_compartida ? b.saldo_extracto : b.saldo_odoo) ?? 0) : Number(b.saldo || 0));

const metodoLabel: Record<string, string> = {
  transferencia: "Transferencia", efectivo: "Efectivo", pago_movil: "Pago Móvil", credito: "Crédito", tarjeta: "Tarjeta", zelle: "Zelle",
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

const emptyForm = {
  nombre: "", metodos: ["transferencia"], moneda: "USD", numero_cuenta: "", titular: "", documento: "", activo: true,
  visible_portal: true, pago_movil_telefono: "", pago_movil_documento: "", pago_movil_banco: "", zelle_correo: "", zelle_titular: "", instrucciones: "",
};

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

  const navigate = useNavigate();
  const { exchangeRate } = useCurrency();
  const [porIdentificar, setPorIdentificar] = useState<PorIdentificar[]>([]);

  const fetchBancos = async () => {
    setLoading(true);
    const [{ data, error }, { data: mv }, { data: ln }, { data: pi }] = await Promise.all([
      supabase.from("bancos").select("*").order("nombre"),
      supabase.from("movimientos_bancarios").select("banco_id, tipo, monto"),
      supabase.from("extracto_odoo_lineas").select("banco_id").eq("conciliada", false),
      supabase.from("movimientos_bancarios").select("id, monto, referencia, descripcion, fecha, banco:bancos(id, nombre, moneda)").eq("origen", "por_identificar").order("fecha"),
    ]);
    if (error) { toast({ title: "Error al cargar bancos", description: error.message, variant: "destructive" }); setLoading(false); return; }
    const saldo = new Map<string, number>();
    for (const m of (mv as { banco_id: string; tipo: string; monto: number }[]) ?? []) {
      saldo.set(m.banco_id, (saldo.get(m.banco_id) || 0) + (m.tipo === "salida" ? -Number(m.monto) : Number(m.monto)));
    }
    const pend = new Map<string, number>();
    for (const l of (ln as { banco_id: string }[]) ?? []) pend.set(l.banco_id, (pend.get(l.banco_id) || 0) + 1);
    setBancos(((data || []) as Banco[]).map((b) => ({ ...b, saldo: saldo.get(b.id) || 0, porConciliar: pend.get(b.id) || 0 })));
    setPorIdentificar((pi as unknown as PorIdentificar[]) ?? []);
    setLoading(false);
  };

  const openNew = () => { setEditing(null); setForm({ ...emptyForm }); setFormOpen(true); };
  const openEdit = (b: Banco) => {
    setEditing(b);
    setForm({
      nombre: b.nombre, metodos: b.metodos && b.metodos.length ? b.metodos : [b.metodo_pago], moneda: b.moneda,
      numero_cuenta: b.numero_cuenta || "", titular: b.titular || "", documento: b.documento || "", activo: b.activo,
      visible_portal: !!b.visible_portal, pago_movil_telefono: b.pago_movil_telefono || "", pago_movil_documento: b.pago_movil_documento || "",
      pago_movil_banco: b.pago_movil_banco || "", zelle_correo: b.zelle_correo || "", zelle_titular: b.zelle_titular || "", instrucciones: b.instrucciones || "",
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.nombre.trim()) { toast({ title: "Falta el nombre", variant: "destructive" }); return; }
    if (form.metodos.length === 0) { toast({ title: "Elegí al menos un método de pago", variant: "destructive" }); return; }
    const pmTel = form.pago_movil_telefono.trim(), zelle = form.zelle_correo.trim();
    if (pmTel && (!form.pago_movil_documento.trim() || !/^\d{4}$/.test(form.pago_movil_banco.trim()))) {
      toast({ title: "Pago móvil incompleto", description: "Indica la cédula o RIF y el código de 4 dígitos del banco.", variant: "destructive" }); return;
    }
    if (zelle && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(zelle)) { toast({ title: "Correo de Zelle inválido", variant: "destructive" }); return; }
    setSaving(true);
    // Pago móvil y Zelle se ofrecen al cliente solo si la cuenta tiene sus datos
    const metodos = [...new Set([...form.metodos.filter((m) => m !== "pago_movil" && m !== "zelle"), ...(pmTel ? ["pago_movil"] : []), ...(zelle ? ["zelle"] : [])])];
    const paraCliente = {
      metodo_pago: metodos[0] || "transferencia", metodos, visible_portal: form.visible_portal,
      pago_movil_telefono: pmTel || null, pago_movil_documento: pmTel ? form.pago_movil_documento.trim() : null, pago_movil_banco: pmTel ? form.pago_movil_banco.trim() : null,
      zelle_correo: zelle || null, zelle_titular: zelle ? form.zelle_titular.trim() || null : null, instrucciones: form.instrucciones.trim() || null,
    };
    const payload = {
      ...paraCliente, nombre: form.nombre.trim(), moneda: form.moneda,
      numero_cuenta: form.numero_cuenta || null, titular: form.titular || null, documento: form.documento || null, activo: form.activo,
    };
    // Banco de Odoo: nombre, moneda, estado, número, banco, titular y RIF vienen de Odoo; GUDS administra métodos y datos para el cliente
    const propios = paraCliente;
    const { error } = editing
      ? await supabase.from("bancos").update(editing.odoo_id ? propios : payload).eq("id", editing.id)
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

  const pagination = usePagination(bancos, 50);
  const conSaldo = bancos.filter((b) => b.activo);
  const totalUsd = conSaldo.filter((b) => b.moneda === "USD").reduce((s, b) => s + saldoDe(b), 0);
  const totalBs = conSaldo.filter((b) => b.moneda !== "USD").reduce((s, b) => s + saldoDe(b), 0);
  const totalPorConciliar = bancos.reduce((s, b) => s + (b.porConciliar || 0), 0);

  return (
    <MainLayout title="Bancos">
      <KpiStrip
        items={[
          { label: "Disponible en dólares", valor: fmtMoneda(totalUsd, "USD"), tono: "positivo" },
          {
            label: "Disponible en bolívares",
            valor: fmtMoneda(totalBs, "BS"),
            detalle: exchangeRate > 0 ? `≈ ${fmtMoneda(totalBs / exchangeRate, "USD")} a tasa BCV` : undefined,
            tono: "primario",
          },
          { label: "Por conciliar en Odoo", valor: totalPorConciliar, detalle: "Líneas de extracto", titulo: "Líneas de extracto por conciliar en Odoo", tono: totalPorConciliar > 0 ? "alerta" : "normal" },
          { label: "Depósitos por identificar", valor: porIdentificar.length, tono: porIdentificar.length > 0 ? "negativo" : "normal", onClick: porIdentificar.length > 0 ? () => document.getElementById("depositos-por-identificar")?.scrollIntoView({ behavior: "smooth" }) : undefined },
        ]}
      />

      <BarraLista
        filtros={
          <p className="min-w-0 text-sm font-semibold">
            Cuentas para recibir pagos
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">Se eligen al registrar un cobro; en bolívares se pide la tasa de cambio.</span>
          </p>
        }
        contador={loading ? undefined : `${bancos.length} registros`}
        acciones={<Button size="sm" className="gap-1.5" onClick={openNew}><Plus className="h-3.5 w-3.5" /> Nuevo Banco</Button>}
      />

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        : bancos.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">No hay cuentas bancarias. Crea la primera con "Nuevo Banco".</div>
        : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Banco</TableHead><TableHead>Cuenta</TableHead><TableHead>Método</TableHead><TableHead>Moneda</TableHead>
              <TableHead className="text-right">Saldo</TableHead><TableHead className="text-right">Por conciliar</TableHead>
              <TableHead>Titular</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Acciones</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pagination.pageItems.map((b) => (
                <TableRow key={b.id} className="cursor-pointer" onClick={() => navigate(`/admin/bancos/${b.id}`)}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="max-w-[260px] truncate" title={b.nombre}>{b.nombre}</span>{b.odoo_id && <OdooBadge />}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{b.numero_cuenta || b.cuenta_odoo || "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 whitespace-nowrap">
                      {(b.metodos && b.metodos.length ? b.metodos : [b.metodo_pago]).map((m) => (
                        <Badge key={m} variant="outline" className="px-1.5 py-0 text-[11px] font-normal">{metodoLabel[m] || m}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap"><Badge variant={b.moneda === "USD" ? "default" : "secondary"}>{b.moneda === "USD" ? "USD $" : "Bs."}</Badge></TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {b.cuenta_compartida && <span className="mr-1.5 text-xs text-warning">según extracto</span>}
                    <span className="font-semibold">{fmtMoneda(saldoDe(b), b.moneda)}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                    {b.porConciliar ? `${b.porConciliar} por conciliar` : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="block max-w-[200px] truncate" title={b.titular || undefined}>{b.titular || "—"}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={b.activo ? "default" : "outline"}>{b.activo ? "Activo" : "Inactivo"}</Badge>
                    {b.visible_portal && <Badge variant="outline" className="ml-1 px-1.5 py-0 text-[11px] font-normal" title="Se muestra a clientes y vendedores como cuenta donde pagar">Portal</Badge>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={() => openEdit(b)}><Pencil className="h-3.5 w-3.5" /></Button>
                      {!b.odoo_id && <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" title="Eliminar" onClick={() => setToDelete(b)}><Trash2 className="h-3.5 w-3.5" /></Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!loading && <DataTablePagination pagination={pagination} />}
      </div>

      {porIdentificar.length > 0 && (
        <section id="depositos-por-identificar" className="mt-3 overflow-hidden rounded-lg border border-warning/50 bg-warning/5">
          <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold">
              <AlertTriangle className="h-3.5 w-3.5 text-warning" /> Depósitos por identificar ({porIdentificar.length}) <OdooBadge titulo="Cobros registrados en Odoo sin cliente" />
            </span>
            <span className="text-xs text-muted-foreground">Entraron al banco pero en Odoo no tienen cliente: identifícalos en Odoo o concílialos con el extracto en GUDS.</span>
          </header>
          <div className="max-h-48 divide-y divide-border overflow-y-auto border-t border-border bg-card">
            {porIdentificar.map((d) => (
              <div key={d.id} className="flex min-w-0 items-center gap-3 px-3 py-1 text-[13px]">
                <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{new Date(d.fecha).toLocaleDateString("es-VE")}</span>
                <span className="min-w-0 max-w-[200px] truncate font-medium" title={d.banco?.nombre || undefined}>{d.banco?.nombre || "—"}</span>
                <span className="min-w-0 max-w-[140px] truncate whitespace-nowrap text-xs text-muted-foreground" title={d.referencia || undefined}>Ref. {d.referencia || "—"}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={d.descripcion || undefined}>{d.descripcion}</span>
                <span className="ml-auto shrink-0 whitespace-nowrap font-semibold text-success">+{fmtMoneda(Number(d.monto), d.banco?.moneda || "BS")}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2">{editing ? "Editar banco" : "Nuevo banco"} {!!editing?.odoo_id && <OdooBadge />}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2"><Label className="flex items-center gap-1.5">Nombre del banco / cuenta {!!editing?.odoo_id && <OdooBadge />}</Label>
              <Input value={form.nombre} disabled={!!editing?.odoo_id} onChange={(e) => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. Banco Mercantil / Zelle" /></div>
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
            <div className="col-span-2"><Label className="flex items-center gap-1.5">Moneda {!!editing?.odoo_id && <OdooBadge />}</Label>
              <Select value={form.moneda} disabled={!!editing?.odoo_id} onValueChange={(v) => setForm(f => ({ ...f, moneda: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">Dólares (USD)</SelectItem>
                  <SelectItem value="BS">Bolívares (Bs.)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!!editing?.banco_nombre && (
              <div className="col-span-2"><Label className="flex items-center gap-1.5">Banco <OdooBadge /></Label>
                <Input value={editing.banco_nombre} disabled /></div>
            )}
            <div className="col-span-2"><Label className="flex items-center gap-1.5">Número de cuenta {!!editing?.odoo_id && <OdooBadge />}</Label>
              <Input value={form.numero_cuenta} disabled={!!editing?.odoo_id} onChange={(e) => setForm(f => ({ ...f, numero_cuenta: e.target.value }))} placeholder="0105-…" /></div>
            <div><Label className="flex items-center gap-1.5">Titular {!!editing?.odoo_id && <OdooBadge />}</Label>
              <Input value={form.titular} disabled={!!editing?.odoo_id} onChange={(e) => setForm(f => ({ ...f, titular: e.target.value }))} /></div>
            <div><Label className="flex items-center gap-1.5">RIF / cédula {!!editing?.odoo_id && <OdooBadge />}</Label>
              <Input value={form.documento} disabled={!!editing?.odoo_id} onChange={(e) => setForm(f => ({ ...f, documento: e.target.value }))} /></div>
            {form.moneda === "BS" ? (
              <fieldset className="col-span-2 grid grid-cols-3 gap-2 rounded-lg border p-3">
                <legend className="px-1 text-xs font-medium text-muted-foreground">Pago móvil (opcional)</legend>
                <div><Label htmlFor="pm-tel" className="text-xs">Teléfono</Label>
                  <Input id="pm-tel" value={form.pago_movil_telefono} onChange={(e) => setForm(f => ({ ...f, pago_movil_telefono: e.target.value }))} placeholder="0414-0000000" /></div>
                <div><Label htmlFor="pm-doc" className="text-xs">Cédula / RIF</Label>
                  <Input id="pm-doc" value={form.pago_movil_documento} onChange={(e) => setForm(f => ({ ...f, pago_movil_documento: e.target.value }))} placeholder="J-00000000-0" /></div>
                <div><Label htmlFor="pm-banco" className="text-xs">Código del banco</Label>
                  <Input id="pm-banco" inputMode="numeric" maxLength={4} value={form.pago_movil_banco} onChange={(e) => setForm(f => ({ ...f, pago_movil_banco: e.target.value.replace(/\D/g, "") }))} placeholder="0134" /></div>
              </fieldset>
            ) : (
              <fieldset className="col-span-2 grid grid-cols-2 gap-2 rounded-lg border p-3">
                <legend className="px-1 text-xs font-medium text-muted-foreground">Zelle (opcional, cuentas de EE. UU.)</legend>
                <div><Label htmlFor="zelle-correo" className="text-xs">Correo registrado en el banco</Label>
                  <Input id="zelle-correo" type="email" value={form.zelle_correo} onChange={(e) => setForm(f => ({ ...f, zelle_correo: e.target.value }))} /></div>
                <div><Label htmlFor="zelle-titular" className="text-xs">Nombre que ve quien paga</Label>
                  <Input id="zelle-titular" value={form.zelle_titular} onChange={(e) => setForm(f => ({ ...f, zelle_titular: e.target.value }))} /></div>
              </fieldset>
            )}
            <div className="col-span-2"><Label htmlFor="banco-instrucciones">Instrucciones para el cliente (opcional)</Label>
              <Input id="banco-instrucciones" value={form.instrucciones} onChange={(e) => setForm(f => ({ ...f, instrucciones: e.target.value }))} placeholder="Ej. Indica el número de factura en el concepto" /></div>
            <div className="col-span-2 flex items-center justify-between rounded-lg border border-border p-3">
              <Label htmlFor="banco-portal" className="cursor-pointer">
                Publicar a clientes y vendedores
                <span className="block text-xs font-normal text-muted-foreground">Aparece en "Cómo pagar" y al declarar un pago.</span>
              </Label>
              <Switch id="banco-portal" checked={form.visible_portal} onCheckedChange={(v) => setForm(f => ({ ...f, visible_portal: v }))} />
            </div>
            <div className="flex items-center justify-between col-span-2 rounded-lg border border-border p-3">
              <Label className="flex cursor-pointer items-center gap-1.5">Activo {!!editing?.odoo_id && <OdooBadge />}</Label>
              <Switch disabled={!!editing?.odoo_id} checked={form.activo} onCheckedChange={(v) => setForm(f => ({ ...f, activo: v }))} />
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
