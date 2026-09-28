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
import { Loader2, UserPlus, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { MetasVendedoresPanel } from "@/components/vendedores/MetasVendedoresPanel";

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
  const pagination = usePagination(filtrados, 50);
  const pgSinAsignar = usePagination(sinAsignar, 50);

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
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const [tab, setTab] = useState<string>("vendedores");
  const pestanas = (
    <TabsList>
      <TabsTrigger value="vendedores">Vendedores ({vendedores.length})</TabsTrigger>
      <TabsTrigger value="sin-asignar">Sin asignar ({sinAsignar.length})</TabsTrigger>
      <TabsTrigger value="metas" data-testid="tab-metas">Metas</TabsTrigger>
    </TabsList>
  );

  return (
    <MainLayout title="Vendedores">
      <KpiStrip
        items={[
          { label: "Vendedores", valor: vendedores.length, tono: "primario" },
          { label: "Cartera total gestionada", valor: formatPrice([...statsPorVendedor.values()].reduce((s, v) => s + v.saldo, 0)), tono: "negativo" },
          { label: "Clientes sin vendedor", valor: sinAsignar.length, tono: "alerta" },
        ]}
      />

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          {/* Pestañas, búsqueda, filtros y acciones de la pestaña activa en una sola fila */}
          {tab === "vendedores" ? (
            <BarraLista
              pestanas={pestanas}
              busqueda={search}
              onBusqueda={setSearch}
              placeholder="Buscar vendedor..."
              contador={`${filtrados.length} registros`}
              acciones={
                <Button size="sm" className="gap-1.5" onClick={() => setOpenNuevo(true)}><UserPlus className="h-3.5 w-3.5" /> Nuevo vendedor</Button>
              }
            />
          ) : tab === "sin-asignar" ? (
            <BarraLista
              pestanas={pestanas}
              filtros={<p className="text-xs text-muted-foreground">Elegí clientes y asignalos a un vendedor.</p>}
              contador={`${sinAsignar.length} registros`}
              acciones={
                <>
                  <Select value={asignarMasivo} onValueChange={setAsignarMasivo}>
                    <SelectTrigger className="h-8 w-56 text-[13px]"><SelectValue placeholder="Elegir vendedor" /></SelectTrigger>
                    <SelectContent>
                      {vendedores.map((v) => <SelectItem key={v.id} value={v.id}>{v.nombre} {v.apellido || ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={!asignarMasivo || seleccionSinAsignar.size === 0} onClick={asignarSeleccion}>
                    Asignar ({seleccionSinAsignar.size})
                  </Button>
                </>
              }
            />
          ) : null}

          <TabsContent value="vendedores" className="mt-2">
            <div className="rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendedor</TableHead><TableHead>Email</TableHead><TableHead>Teléfono</TableHead>
                    <TableHead className="text-center">Clientes</TableHead>
                    <TableHead className="text-right">Cartera</TableHead>
                    <TableHead className="text-center">Activo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagination.pageItems.map((v) => {
                    const st = statsPorVendedor.get(v.id) || { clientes: 0, saldo: 0 };
                    const nombreCompleto = `${v.nombre} ${v.apellido || ""}`.trim();
                    return (
                      <TableRow key={v.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/vendedores/${v.id}`)}>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                            <span className="max-w-[260px] truncate font-medium" title={nombreCompleto}>{nombreCompleto}</span>
                            <Badge variant="secondary">Vendedor</Badge>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate whitespace-nowrap text-muted-foreground" title={v.email}>{v.email}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{v.telefono || "—"}</TableCell>
                        <TableCell className="text-center">{st.clientes}</TableCell>
                        <TableCell className={`whitespace-nowrap text-right font-semibold ${st.saldo > 0.009 ? "text-destructive" : ""}`}>{formatPrice(st.saldo)}</TableCell>
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

          <TabsContent value="sin-asignar" className="mt-2">
            <div className="rounded-lg border border-border bg-card">
              {sinAsignar.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">Todos los clientes activos tienen vendedor asignado.</p>
              ) : (
                <>
                  <Table>
                    <TableHeader><TableRow><TableHead className="w-8"></TableHead><TableHead>Cliente</TableHead><TableHead className="text-right">Saldo</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {pgSinAsignar.pageItems.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell><input type="checkbox" checked={seleccionSinAsignar.has(c.id)} onChange={() => toggleSeleccion(c.id)} /></TableCell>
                          <TableCell>
                            <div className="flex min-w-0 items-center whitespace-nowrap">
                              <span className="max-w-[260px] truncate font-medium" title={c.nombre_negocio}>{c.nombre_negocio}</span>
                              {c.codigo && <span className="ml-1.5 text-xs text-muted-foreground">{c.codigo}</span>}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(saldoPorCliente[c.id] || 0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <DataTablePagination pagination={pgSinAsignar} />
                </>
              )}
            </div>
          </TabsContent>

          {/* Metas por vendedor y mes (su propia barra con el mes; solo personal de administración) */}
          <TabsContent value="metas" className="mt-0">
            <MetasVendedoresPanel pestanas={pestanas} />
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
