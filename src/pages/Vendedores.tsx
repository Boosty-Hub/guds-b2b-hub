import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { Loader2, UserPlus, Eye, EyeOff, Mail, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/contexts/CurrencyContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { MetasVendedoresPanel } from "@/components/vendedores/MetasVendedoresPanel";
import {
  FiltrosLista, useFiltros, opcionesDe, opcionesTexto, opcionesPrueba, pasaPrueba, coincide, coincideTexto, contadorFiltrado, type DefFiltro, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { estadoVe } from "@/components/clientes/odooCliente";
import { VendedorAccesoDialog, type VendedorAcceso } from "@/components/vendedores/VendedorAccesoDialog";

// Vendedores de la empresa activa (vendedores_empresa, fase 21a): los de la otra empresa no salen con "0 clientes" y los
// usuarios de prueba (QA) no aparecen. `empresas` = empresas visibles a las que pertenece (por sus clientes de Odoo).
interface Vendedor extends VendedorAcceso {
  telefono: string | null; activo: boolean; empresas: string[] | null; clientes: number;
  correo_pendiente: boolean; ultimo_ingreso: string | null; debe_cambiar_clave: boolean;
}
// Los empleados (compras de personal) no son cartera de vendedor ni cuentan como "sin vendedor" (se excluyen al cargar)
interface ClienteLite { id: string; nombre_negocio: string; codigo: string | null; vendedor_asignado_id: string | null; ciudad: string | null; estado: string | null; }
// Pestañas (en la URL, ?tab=) y sus filtros: los de una pestaña se limpian al pasar a otra
const PESTANAS_VEND = ["vendedores", "sin-asignar", "metas"] as const;
const CLAVES_PESTANA = ["empresa", "meta", "activo", "cartera", "correo", "estado", "ciudad", "saldo"];
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
  // Vendedores con meta cargada en el mes en curso (empresa activa o ambas)
  const [conMeta, setConMeta] = useState<Set<string>>(new Set());
  const { empresas, soloLectura } = useEmpresa();
  const [acceso, setAcceso] = useState<Vendedor | null>(null);

  const [openNuevo, setOpenNuevo] = useState(false);
  const [form, setForm] = useState({ nombre: "", apellido: "", email: "", telefono: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [credenciales, setCredenciales] = useState<{ email: string; password: string } | null>(null);

  const [asignarMasivo, setAsignarMasivo] = useState("");
  const [seleccionSinAsignar, setSeleccionSinAsignar] = useState<Set<string>>(new Set());

  const fetchAll = async () => {
    setLoading(true);
    const [anio, mes] = new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" }).slice(0, 7).split("-").map(Number);
    const [{ data: vends }, { data: clis }, { data: facs }, { data: metas }] = await Promise.all([
      supabase.rpc("vendedores_empresa"),
      supabase.from("clientes").select("id, nombre_negocio, codigo, vendedor_asignado_id, ciudad, estado").eq("activo", true).eq("es_empleado", false).order("nombre_negocio"),
      supabase.from("facturas").select("cliente_id, saldo_usd").eq("estado", "posted"),
      supabase.from("metas_vendedor").select("vendedor_id, meta_ventas").eq("anio", anio).eq("mes", mes).gt("meta_ventas", 0),
    ]);
    setVendedores(((vends as Vendedor[] | null) ?? []).map((v) => ({ ...v, clientes: Number(v.clientes ?? 0) })));
    setConMeta(new Set(((metas as { vendedor_id: string }[] | null) ?? []).map((m) => m.vendedor_id)));
    setClientes((clis as ClienteLite[]) ?? []);
    const saldoMap: Record<string, number> = {};
    for (const f of (facs as FacturaSaldoRow[]) ?? []) {
      saldoMap[f.cliente_id] = (saldoMap[f.cliente_id] || 0) + Number(f.saldo_usd);
    }
    setSaldoPorCliente(saldoMap);
    setLoading(false);
  };
  useEffect(() => { fetchAll(); }, []);

  const idsVendedores = useMemo(() => new Set(vendedores.map((v) => v.id)), [vendedores]);
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
  const correosPendientes = vendedores.filter((v) => v.correo_pendiente).length;

  // ---- Pestaña y filtros (en la URL) ----
  const [params, setParams] = useSearchParams();
  const tab = (PESTANAS_VEND as readonly string[]).includes(params.get("tab") ?? "") ? params.get("tab")! : "vendedores";
  const setTab = (t: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    for (const k of CLAVES_PESTANA) n.delete(k);
    if (t === "vendedores") n.delete("tab"); else n.set("tab", t);
    return n;
  }, { replace: true });
  const siNo = <T,>(si: string, no: string, fn: (x: T) => boolean): OpcionPrueba<T>[] =>
    [{ valor: "si", etiqueta: si, prueba: fn }, { valor: "no", etiqueta: no, prueba: (x) => !fn(x) }];
  const pruebasEmpresa: OpcionPrueba<Vendedor>[] = empresas.map((e) => ({
    valor: e.id, etiqueta: e.nombre_corto || e.nombre, prueba: (v: Vendedor) => (v.empresas ?? []).includes(e.id),
  }));
  const pruebasCorreo = siNo<Vendedor>("Con correo real", "Correo de relleno (@guds.test)", (v) => !v.correo_pendiente);
  const pruebasMeta = siNo<Vendedor>("Con meta este mes", "Sin meta este mes", (v) => conMeta.has(v.id));
  const pruebasActivo = siNo<Vendedor>("Activos", "Inactivos", (v) => v.activo);
  const pruebasCartera: OpcionPrueba<Vendedor>[] = [
    { valor: "con", etiqueta: "Con clientes asignados", prueba: (v) => (statsPorVendedor.get(v.id)?.clientes ?? 0) > 0 },
    { valor: "deuda", etiqueta: "Con cartera por cobrar", prueba: (v) => (statsPorVendedor.get(v.id)?.saldo ?? 0) > 0.009 },
    { valor: "sin", etiqueta: "Sin clientes", prueba: (v) => !(statsPorVendedor.get(v.id)?.clientes ?? 0) },
  ];
  const pruebasSaldo = siNo<ClienteLite>("Con saldo por cobrar", "Sin saldo", (c) => (saldoPorCliente[c.id] || 0) > 0.009);
  const defsPestana: Record<string, DefFiltro[]> = {
    vendedores: [
      ...(empresas.length > 1 && soloLectura ? [{ clave: "empresa", etiqueta: "Empresa", todos: "Todas", principal: true, opciones: opcionesPrueba(vendedores, pruebasEmpresa) }] : []),
      { clave: "meta", etiqueta: "Meta", todos: "Con y sin meta", principal: true, opciones: opcionesPrueba(vendedores, pruebasMeta) },
      { clave: "activo", etiqueta: "Situación", todos: "Activos e inactivos", principal: true, opciones: opcionesPrueba(vendedores, pruebasActivo) },
      { clave: "cartera", etiqueta: "Cartera", todos: "Todas", opciones: opcionesPrueba(vendedores, pruebasCartera) },
      { clave: "correo", etiqueta: "Correo", todos: "Todos", opciones: opcionesPrueba(vendedores, pruebasCorreo) },
    ],
    "sin-asignar": [
      { clave: "estado", etiqueta: "Estado", todos: "Todos los estados", principal: true, opciones: opcionesDe(sinAsignar, (c) => estadoVe(c.estado) ?? c.estado, undefined, "Sin estado") },
      { clave: "ciudad", etiqueta: "Ciudad", todos: "Todas las ciudades", principal: true, opciones: opcionesTexto(sinAsignar, (c) => c.ciudad, "Sin ciudad") },
      { clave: "saldo", etiqueta: "Saldo", todos: "Todos", principal: true, opciones: opcionesPrueba(sinAsignar, pruebasSaldo) },
    ],
    metas: [],
  };
  const f = useFiltros(defsPestana[tab]);

  const filtrados = vendedores.filter((v) =>
    (`${v.nombre} ${v.apellido || ""}`.toLowerCase().includes(search.toLowerCase()) || v.email.toLowerCase().includes(search.toLowerCase()))
    && pasaPrueba(pruebasEmpresa, f.v("empresa"), v) && pasaPrueba(pruebasMeta, f.v("meta"), v) && pasaPrueba(pruebasActivo, f.v("activo"), v)
    && pasaPrueba(pruebasCartera, f.v("cartera"), v) && pasaPrueba(pruebasCorreo, f.v("correo"), v));
  const sinAsignarFiltrados = sinAsignar.filter((c) => coincide(estadoVe(c.estado) ?? c.estado, f.v("estado")) && coincideTexto(c.ciudad, f.v("ciudad"))
    && pasaPrueba(pruebasSaldo, f.v("saldo"), c));
  const pagination = usePagination(filtrados, 50, f.firma);
  const pgSinAsignar = usePagination(sinAsignarFiltrados, 50, f.firma);

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
          { label: "Cartera total gestionada", valor: formatPrice([...statsPorVendedor.entries()].filter(([id]) => idsVendedores.has(id)).reduce((s, [, v]) => s + v.saldo, 0)), tono: "negativo" },
          { label: "Clientes sin vendedor", valor: sinAsignar.length, tono: "alerta", detalle: "sin contar empleados" },
          { label: "Correo de relleno", valor: correosPendientes, tono: correosPendientes ? "alerta" : "normal", detalle: "falta el correo real",
            activo: f.v("correo") === "no", onClick: tab === "vendedores" ? () => f.set("correo", f.v("correo") === "no" ? "" : "no") : undefined },
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
              filtros={<FiltrosLista filtros={f} resultados={filtrados.length} />}
              contador={contadorFiltrado(filtrados.length, vendedores.length, f.activos || !!search.trim())}
              acciones={
                <Button size="sm" className="gap-1.5" onClick={() => setOpenNuevo(true)}><UserPlus className="h-3.5 w-3.5" /> Nuevo vendedor</Button>
              }
            />
          ) : tab === "sin-asignar" ? (
            <BarraLista
              pestanas={pestanas}
              filtros={<>
                <FiltrosLista filtros={f} resultados={sinAsignarFiltrados.length} />
                <p className="hidden text-xs text-muted-foreground xl:block">Elegí clientes y asignalos a un vendedor.</p>
              </>}
              contador={contadorFiltrado(sinAsignarFiltrados.length, sinAsignar.length, f.activos)}
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
                    <TableHead>Vendedor</TableHead>{soloLectura && empresas.length > 1 && <TableHead>Empresas</TableHead>}<TableHead>Email</TableHead><TableHead>Teléfono</TableHead>
                    <TableHead className="text-center">Clientes</TableHead>
                    <TableHead className="text-right">Cartera</TableHead>
                    <TableHead className="text-center">Activo</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtrados.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                      {vendedores.length ? "Ningún vendedor coincide con la búsqueda o los filtros." : "No hay vendedores en esta empresa."}
                    </TableCell></TableRow>
                  )}
                  {pagination.pageItems.map((v) => {
                    const st = statsPorVendedor.get(v.id) || { clientes: 0, saldo: 0 };
                    const nombreCompleto = `${v.nombre} ${v.apellido || ""}`.trim();
                    return (
                      <TableRow key={v.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/vendedores/${v.id}`)}>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                            <span className="max-w-[260px] truncate font-medium" title={nombreCompleto}>{nombreCompleto}</span>
                          </div>
                        </TableCell>
                        {soloLectura && empresas.length > 1 && (
                          <TableCell className="whitespace-nowrap">
                            <div className="flex gap-1">{(v.empresas ?? []).map((id) => (
                              <Badge key={id} variant="outline" className="px-1.5 py-0 text-[10px]">{empresas.find((e) => e.id === id)?.nombre_corto ?? "—"}</Badge>
                            ))}</div>
                          </TableCell>
                        )}
                        <TableCell className="max-w-[260px] whitespace-nowrap text-muted-foreground" title={v.email}>
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate">{v.email}</span>
                            {v.correo_pendiente && (
                              <Badge variant="outline" className="shrink-0 gap-1 border-amber-500/50 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-300" title="Correo de relleno: carga el real con el botón de correo">
                                <AlertTriangle className="h-3 w-3" />relleno
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{v.telefono || "—"}</TableCell>
                        <TableCell className="text-center">{st.clientes}</TableCell>
                        <TableCell className={`whitespace-nowrap text-right font-semibold ${st.saldo > 0.009 ? "text-destructive" : ""}`}>{formatPrice(st.saldo)}</TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <Switch checked={v.activo} onCheckedChange={() => toggleActivo(v)} />
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Correo real e invitación" aria-label={`Correo y acceso de ${nombreCompleto}`}
                            data-testid="vendedor-acceso" onClick={() => setAcceso(v)}>
                            <Mail className="h-3.5 w-3.5" />
                          </Button>
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
              {sinAsignarFiltrados.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {sinAsignar.length === 0 ? "Todos los clientes activos tienen vendedor asignado." : "Ningún cliente sin vendedor coincide con los filtros."}
                  {f.activos > 0 && <button type="button" className="ml-2 text-xs font-medium text-primary hover:underline" onClick={f.limpiar}>Limpiar filtros</button>}
                </p>
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

      <VendedorAccesoDialog vendedor={acceso} onOpenChange={(o) => { if (!o) setAcceso(null); }} onHecho={fetchAll} />

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
