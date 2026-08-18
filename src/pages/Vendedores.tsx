import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, UserPlus, Users, Wallet, UserX, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

interface Vendedor {
  id: string; nombre: string; apellido: string | null; email: string; telefono: string | null; activo: boolean;
}
interface ClienteLite { id: string; nombre_negocio: string; codigo: string | null; vendedor_asignado_id: string | null; }
interface FacturaSaldoRow { cliente_id: string; saldo_usd: number; }

const Vendedores = () => {
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const { toast } = useToast();
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [clientes, setClientes] = useState<ClienteLite[]>([]);
  const [saldoPorCliente, setSaldoPorCliente] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [openNuevo, setOpenNuevo] = useState(false);
  const [form, setForm] = useState({ nombre: "", apellido: "", email: "", telefono: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [credenciales, setCredenciales] = useState<{ email: string; password: string } | null>(null);

  const [asignarMasivo, setAsignarMasivo] = useState("");
  const [seleccionSinAsignar, setSeleccionSinAsignar] = useState<Set<string>>(new Set());

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: vends }, { data: clis }, { data: facs }] = await Promise.all([
      supabase.from("usuarios").select("id, nombre, apellido, email, telefono, activo").eq("role", "vendedor").order("nombre"),
      supabase.from("clientes").select("id, nombre_negocio, codigo, vendedor_asignado_id").eq("activo", true).order("nombre_negocio"),
      supabase.from("facturas").select("cliente_id, saldo_usd").eq("estado", "posted"),
    ]);
    setVendedores((vends as Vendedor[]) ?? []);
    setClientes((clis as ClienteLite[]) ?? []);
    const saldoMap: Record<string, number> = {};
    for (const f of (facs as FacturaSaldoRow[]) ?? []) {
      saldoMap[f.cliente_id] = (saldoMap[f.cliente_id] || 0) + Number(f.saldo_usd);
    }
    setSaldoPorCliente(saldoMap);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  const statsPorVendedor = useMemo(() => {
    const m = new Map<string, { clientes: number; saldo: number }>();
    for (const c of clientes) {
      if (!c.vendedor_asignado_id) continue;
      const cur = m.get(c.vendedor_asignado_id) || { clientes: 0, saldo: 0 };
      cur.clientes += 1;
      cur.saldo += saldoPorCliente[c.id] || 0;
      m.set(c.vendedor_asignado_id, cur);
    }
    return m;
  }, [clientes, saldoPorCliente]);

  const sinAsignar = useMemo(() => clientes.filter((c) => !c.vendedor_asignado_id), [clientes]);

  const filtrados = vendedores.filter((v) =>
    `${v.nombre} ${v.apellido || ""}`.toLowerCase().includes(search.toLowerCase()) || v.email.toLowerCase().includes(search.toLowerCase()));
  const pagination = usePagination(filtrados, 25);
  const pgSinAsignar = usePagination(sinAsignar, 25);

  const toggleActivo = async (v: Vendedor) => {
    const { error } = await supabase.from("usuarios").update({ activo: !v.activo }).eq("id", v.id);
    if (error) { toast({ title: "No se pudo cambiar el estado", description: error.message, variant: "destructive" }); return; }
    fetchAll();
  };

  const crearVendedor = async () => {
    if (!form.nombre || !form.email || !form.password || form.password.length < 6) {
      toast({ title: "Faltan datos", description: "Nombre, email y contraseña (mín. 6 caracteres) son requeridos.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("crear_usuario_admin", {
      p_email: form.email, p_nombre: form.nombre, p_apellido: form.apellido || null,
      p_role: "vendedor", p_telefono: form.telefono || null, p_password: form.password,
    });
    setSaving(false);
    if (error) { toast({ title: "No se pudo crear el vendedor", description: error.message, variant: "destructive" }); return; }
    const row = Array.isArray(data) ? data[0] : data;
    setOpenNuevo(false);
    setForm({ nombre: "", apellido: "", email: "", telefono: "", password: "" });
    if (row?.password_temporal) setCredenciales({ email: form.email, password: row.password_temporal });
    toast({ title: "Vendedor creado", description: `${form.nombre} ya puede ingresar al portal.` });
    fetchAll();
  };

  const asignarSeleccion = async () => {
    if (!asignarMasivo || seleccionSinAsignar.size === 0) return;
    const { error } = await supabase.from("clientes").update({ vendedor_asignado_id: asignarMasivo }).in("id", [...seleccionSinAsignar]);
    if (error) { toast({ title: "No se pudo asignar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Clientes asignados", description: `${seleccionSinAsignar.size} cliente(s) asignado(s).` });
    setSeleccionSinAsignar(new Set());
    setAsignarMasivo("");
    fetchAll();
  };

  const toggleSeleccion = (id: string) => {
    setSeleccionSinAsignar((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <MainLayout title="Vendedores">
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2"><Users className="h-5 w-5 text-primary" /></div>
            <div><p className="text-2xl font-bold">{vendedores.length}</p><p className="text-sm text-muted-foreground">Vendedores</p></div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-destructive/10 p-2"><Wallet className="h-5 w-5 text-destructive" /></div>
            <div><p className="text-2xl font-bold">{formatPrice([...statsPorVendedor.values()].reduce((s, v) => s + v.saldo, 0))}</p><p className="text-sm text-muted-foreground">Cartera total gestionada</p></div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2"><UserX className="h-5 w-5 text-warning" /></div>
            <div><p className="text-2xl font-bold">{sinAsignar.length}</p><p className="text-sm text-muted-foreground">Clientes sin vendedor</p></div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <Tabs defaultValue="vendedores">
          <TabsList>
            <TabsTrigger value="vendedores">Vendedores ({vendedores.length})</TabsTrigger>
            <TabsTrigger value="sin-asignar">Sin asignar ({sinAsignar.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="vendedores" className="mt-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative max-w-md flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar vendedor..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Button className="gap-2" onClick={() => setOpenNuevo(true)}><UserPlus className="h-4 w-4" /> Nuevo vendedor</Button>
            </div>
            <div className="rounded-xl border border-border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendedor</TableHead><TableHead>Contacto</TableHead>
                    <TableHead className="text-center">Clientes</TableHead>
                    <TableHead className="text-right">Cartera</TableHead>
                    <TableHead className="text-center">Activo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagination.pageItems.map((v) => {
                    const st = statsPorVendedor.get(v.id) || { clientes: 0, saldo: 0 };
                    return (
                      <TableRow key={v.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/vendedores/${v.id}`)}>
                        <TableCell>
                          <p className="font-medium">{v.nombre} {v.apellido || ""}</p>
                          <Badge variant="secondary" className="mt-1">Vendedor</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{v.email}{v.telefono ? ` · ${v.telefono}` : ""}</TableCell>
                        <TableCell className="text-center">{st.clientes}</TableCell>
                        <TableCell className={`text-right font-semibold ${st.saldo > 0.009 ? "text-destructive" : ""}`}>{formatPrice(st.saldo)}</TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <Switch checked={v.activo} onCheckedChange={() => toggleActivo(v)} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <DataTablePagination pagination={pagination} />
            </div>
          </TabsContent>

          <TabsContent value="sin-asignar" className="mt-4 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">Elegí clientes y asignalos a un vendedor.</p>
              <div className="flex gap-2">
                <Select value={asignarMasivo} onValueChange={setAsignarMasivo}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="Elegir vendedor" /></SelectTrigger>
                  <SelectContent>
                    {vendedores.map((v) => <SelectItem key={v.id} value={v.id}>{v.nombre} {v.apellido || ""}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button disabled={!asignarMasivo || seleccionSinAsignar.size === 0} onClick={asignarSeleccion}>
                  Asignar ({seleccionSinAsignar.size})
                </Button>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card shadow-sm">
              {sinAsignar.length === 0 ? (
                <p className="p-8 text-center text-muted-foreground">Todos los clientes activos tienen vendedor asignado.</p>
              ) : (
                <>
                  <Table>
                    <TableHeader><TableRow><TableHead className="w-10"></TableHead><TableHead>Cliente</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {pgSinAsignar.pageItems.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell><input type="checkbox" checked={seleccionSinAsignar.has(c.id)} onChange={() => toggleSeleccion(c.id)} /></TableCell>
                          <TableCell><p className="font-medium">{c.nombre_negocio}</p><p className="text-xs text-muted-foreground">{c.codigo}</p></TableCell>
                          <TableCell className="text-right font-semibold">{formatPrice(saldoPorCliente[c.id] || 0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <DataTablePagination pagination={pgSinAsignar} />
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* Nuevo vendedor */}
      <Dialog open={openNuevo} onOpenChange={setOpenNuevo}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuevo Vendedor</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Nombre *</Label><Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
              <div className="space-y-2"><Label>Apellido</Label><Input value={form.apellido} onChange={(e) => setForm({ ...form, apellido: e.target.value })} /></div>
            </div>
            <div className="space-y-2"><Label>Email *</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-2"><Label>Teléfono</Label><Input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Contraseña *</Label>
              <div className="relative">
                <Input type={showPassword ? "text" : "password"} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mínimo 6 caracteres" />
                <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-0 h-full" onClick={() => setShowPassword((s) => !s)}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenNuevo(false)}>Cancelar</Button>
            <Button onClick={crearVendedor} disabled={saving} className="gap-2">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Crear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credenciales del vendedor recién creado */}
      <Dialog open={!!credenciales} onOpenChange={(o) => { if (!o) setCredenciales(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Vendedor creado — credenciales de acceso</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <p className="text-muted-foreground">Comunicá estas credenciales por un canal seguro. La contraseña <b>solo se muestra una vez</b>.</p>
            <div className="space-y-2 rounded-lg border border-border bg-muted p-3">
              <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Email</span><code className="font-medium">{credenciales?.email}</code></div>
              <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">Contraseña</span><code className="font-bold text-primary">{credenciales?.password}</code></div>
            </div>
          </div>
          <DialogFooter><Button onClick={() => setCredenciales(null)}>Entendido</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Vendedores;
