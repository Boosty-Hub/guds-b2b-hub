import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ArrowLeft, Loader2, Plus, Pencil, Trash2, KeyRound, UserPlus, Copy, Mail, Phone, ShieldCheck, ShieldOff, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionsContext";

interface Contacto {
  id: string; nombre: string; cargo: string | null; email: string | null; telefono: string | null; celular: string | null;
  es_principal: boolean; activo: boolean; notas: string | null; odoo_id?: number | null;
}
interface UsuarioPortal { id: string; email: string; activo: boolean; debe_cambiar_clave: boolean; contacto_id: string | null; nombre: string; apellido: string | null }
interface Credenciales { titulo: string; email: string; password: string }
// Empresas que se ofrecen al cliente en el portal (migración 19s)
interface EmpresaPortal { empresa_id: string; empresa: string; ficha_id: string | null; habilitada: boolean; principal: boolean; usuarios: number }

const vacio = { nombre: "", cargo: "", email: "", telefono: "", celular: "", es_principal: false, notas: "" };

const ClienteUsuarios = () => {
  const { clienteId } = useParams<{ clienteId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { can } = usePermissions();
  const puedeEditar = can("clientes", "editar");
  const [cliente, setCliente] = useState<{ nombre_negocio: string; rif: string | null } | null>(null);
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [usuarios, setUsuarios] = useState<UsuarioPortal[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...vacio });
  const [editando, setEditando] = useState<Contacto | null>(null);
  const [formAbierto, setFormAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aBorrar, setABorrar] = useState<Contacto | null>(null);
  const [credenciales, setCredenciales] = useState<Credenciales | null>(null);
  const [empresasPortal, setEmpresasPortal] = useState<EmpresaPortal[]>([]);
  const [cambiandoEmpresa, setCambiandoEmpresa] = useState<string | null>(null);

  const cargar = async () => {
    setLoading(true);
    const [{ data: c }, { data: k }, { data: u }, { data: ep }] = await Promise.all([
      supabase.from("clientes").select("nombre_negocio, rif").eq("id", clienteId).maybeSingle(),
      supabase.from("cliente_contactos").select("*").eq("cliente_id", clienteId).order("es_principal", { ascending: false }).order("nombre"),
      supabase.from("usuarios").select("id, email, activo, debe_cambiar_clave, contacto_id, nombre, apellido").eq("cliente_id", clienteId).eq("role", "cliente"),
      supabase.rpc("empresas_portal_cliente", { p_cliente_id: clienteId }),
    ]);
    setEmpresasPortal((ep as EmpresaPortal[] | null) ?? []);
    setCliente(c as { nombre_negocio: string; rif: string | null } | null);
    setContactos((k as Contacto[]) ?? []);
    setUsuarios((u as UsuarioPortal[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { cargar(); }, [clienteId]);

  const usuarioDe = (contactoId: string) => usuarios.find((u) => u.contacto_id === contactoId) ?? null;
  const sinContacto = usuarios.filter((u) => !u.contacto_id);

  const abrirNuevo = () => { setEditando(null); setForm({ ...vacio, es_principal: contactos.length === 0 }); setFormAbierto(true); };
  const abrirEditar = (k: Contacto) => {
    setEditando(k);
    setForm({ nombre: k.nombre, cargo: k.cargo || "", email: k.email || "", telefono: k.telefono || "", celular: k.celular || "", es_principal: k.es_principal, notas: k.notas || "" });
    setFormAbierto(true);
  };

  const guardar = async () => {
    if (!form.nombre.trim()) { toast({ title: "Falta el nombre del contacto", variant: "destructive" }); return; }
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) { toast({ title: "Correo no válido", variant: "destructive" }); return; }
    const u = editando ? usuarioDe(editando.id) : null;
    if (u && form.email.trim().toLowerCase() !== (editando?.email || "").toLowerCase()) {
      toast({ title: "El correo es el usuario del portal", description: "Para cambiarlo, quita el acceso y vuelve a darlo con el correo nuevo.", variant: "destructive" });
      return;
    }
    setGuardando(true);
    const payload = {
      nombre: form.nombre.trim(), cargo: form.cargo.trim() || null, email: form.email.trim().toLowerCase() || null,
      telefono: form.telefono.trim() || null, celular: form.celular.trim() || null, es_principal: form.es_principal, notas: form.notas.trim() || null,
    };
    if (payload.es_principal) {
      await supabase.from("cliente_contactos").update({ es_principal: false }).eq("cliente_id", clienteId).neq("id", editando?.id ?? "00000000-0000-0000-0000-000000000000");
    }
    const { error } = editando
      ? await supabase.from("cliente_contactos").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", editando.id)
      : await supabase.from("cliente_contactos").insert({ ...payload, cliente_id: clienteId });
    setGuardando(false);
    if (error) { toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" }); return; }
    toast({ title: editando ? "Contacto actualizado" : "Contacto agregado", description: payload.nombre });
    setFormAbierto(false);
    cargar();
  };

  const borrar = async () => {
    if (!aBorrar) return;
    const { error } = await supabase.from("cliente_contactos").delete().eq("id", aBorrar.id);
    if (error) toast({ title: "No se pudo eliminar", description: error.message, variant: "destructive" });
    else { toast({ title: "Contacto eliminado", description: aBorrar.nombre }); cargar(); }
    setABorrar(null);
  };

  const darAcceso = async (k: Contacto) => {
    setTrabajando(k.id);
    const { data, error } = await supabase.rpc("crear_acceso_contacto", { p_contacto_id: k.id });
    setTrabajando(null);
    if (error) { toast({ title: "No se pudo dar acceso", description: error.message, variant: "destructive" }); return; }
    const r = (data as { email: string; password_temporal: string }[] | null)?.[0];
    if (r) setCredenciales({ titulo: `Acceso al portal para ${k.nombre}`, email: r.email, password: r.password_temporal });
    cargar();
  };

  const restablecer = async (u: UsuarioPortal, nombre: string) => {
    setTrabajando(u.id);
    const { data, error } = await supabase.rpc("restablecer_clave_cliente", { p_usuario_id: u.id });
    setTrabajando(null);
    if (error) { toast({ title: "No se pudo restablecer", description: error.message, variant: "destructive" }); return; }
    setCredenciales({ titulo: `Nueva contraseña temporal para ${nombre}`, email: u.email, password: data as string });
    cargar();
  };

  const cambiarAcceso = async (u: UsuarioPortal, activo: boolean) => {
    setTrabajando(u.id);
    const { error } = await supabase.rpc("cambiar_acceso_cliente", { p_usuario_id: u.id, p_activo: activo });
    setTrabajando(null);
    if (error) { toast({ title: "No se pudo cambiar el acceso", description: error.message, variant: "destructive" }); return; }
    toast({ title: activo ? "Acceso reactivado" : "Acceso desactivado", description: u.email });
    cargar();
  };

  const copiar = async (texto: string) => {
    try { await navigator.clipboard.writeText(texto); toast({ title: "Copiado" }); } catch { toast({ title: "No se pudo copiar", variant: "destructive" }); }
  };
  const mensaje = credenciales
    ? `Hola, ya tienes acceso al portal de clientes de GUDS.\nEntra en ${window.location.origin}/login\nUsuario: ${credenciales.email}\nContraseña temporal: ${credenciales.password}\nAl entrar se te pedirá crear tu propia contraseña.`
    : "";

  const cambiarEmpresaPortal = async (e: EmpresaPortal, habilitada: boolean) => {
    setCambiandoEmpresa(e.empresa_id);
    const { error } = await supabase.rpc("habilitar_empresa_portal", { p_cliente_id: clienteId, p_empresa_id: e.empresa_id, p_habilitado: habilitada });
    setCambiandoEmpresa(null);
    if (error) { toast({ title: "No se pudo cambiar", description: error.message, variant: "destructive" }); return; }
    toast({ title: habilitada ? `${e.empresa} habilitada en el portal` : `${e.empresa} deshabilitada en el portal` });
    setEmpresasPortal((l) => l.map((x) => (x.empresa_id === e.empresa_id ? { ...x, habilitada } : x)));
  };

  const estadoAcceso = (u: UsuarioPortal | null) => {
    if (!u) return <Badge variant="outline" className="font-normal text-muted-foreground">Sin acceso</Badge>;
    if (!u.activo) return <Badge variant="outline" className="border-destructive/40 bg-destructive/10 font-normal text-destructive">Desactivado</Badge>;
    if (u.debe_cambiar_clave) return <Badge variant="outline" className="border-warning/60 bg-warning/15 font-normal">Clave temporal</Badge>;
    return <Badge variant="outline" className="border-success/40 bg-success/10 font-normal text-success">Activo</Badge>;
  };

  return (
    <MainLayout title="Contactos y acceso al portal">
      <Button variant="ghost" size="sm" className="mb-2 h-7 gap-1.5 px-2 text-xs" onClick={() => navigate(`/admin/clientes/${clienteId}`)}><ArrowLeft className="h-3.5 w-3.5" /> Volver al cliente</Button>

      <div className="mb-3 flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-card p-3">
        <div>
          <h1 className="text-base font-semibold">{cliente?.nombre_negocio || "Cliente"}</h1>
          <p className="text-sm text-muted-foreground">{cliente?.rif || ""}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Personas del cliente. Cada contacto con correo puede tener su propio usuario del portal: GUDS genera una contraseña temporal
            que le compartes y, al entrar por primera vez, el contacto crea la suya.
          </p>
        </div>
        {puedeEditar && <Button className="gap-2" onClick={abrirNuevo}><Plus className="h-4 w-4" /> Nuevo contacto</Button>}
      </div>

      {empresasPortal.length > 1 && (
        <section className="mb-3 rounded-lg border border-border bg-card p-3" aria-labelledby="empresas-portal">
          <h2 id="empresas-portal" className="text-sm font-semibold">Empresas en el portal</h2>
          <p className="mb-2 text-xs text-muted-foreground">
            El cliente solo ve y compra en las empresas habilitadas. Con más de una, el portal le muestra el selector de empresa.
          </p>
          <div className="flex flex-wrap gap-2">
            {empresasPortal.map((e) => (
              <label key={e.empresa_id}
                className={`flex min-w-[220px] flex-1 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 ${e.ficha_id ? "cursor-pointer" : "opacity-60"}`}
                title={!e.ficha_id ? `No es cliente de ${e.empresa} en Odoo` : e.principal ? "La empresa de esta ficha siempre está habilitada" : undefined}>
                <span className="text-sm">
                  <span className="font-medium">{e.empresa}</span>
                  <span className="block text-xs text-muted-foreground">
                    {!e.ficha_id ? "Sin ficha en Odoo" : e.principal ? "Empresa de esta ficha" : e.habilitada ? "Habilitada" : "No habilitada"}
                  </span>
                </span>
                {cambiandoEmpresa === e.empresa_id ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
                  <Switch checked={e.habilitada} aria-label={`Portal: ${e.empresa}`}
                    disabled={!puedeEditar || !e.ficha_id || e.principal}
                    onCheckedChange={(v) => cambiarEmpresaPortal(e, v)} />
                )}
              </label>
            ))}
          </div>
        </section>
      )}

      <div className="rounded-lg border border-border bg-card">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : contactos.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-muted-foreground"><Users className="mb-3 h-10 w-10 opacity-50" /><p>Este cliente todavía no tiene contactos.</p></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Contacto</TableHead><TableHead>Correo / teléfono</TableHead><TableHead>Portal</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {contactos.map((k) => {
                const u = usuarioDe(k.id);
                return (
                  <TableRow key={k.id}>
                    <TableCell>
                      <div className="font-medium">{k.nombre}{k.es_principal && <Badge variant="secondary" className="ml-2 text-[10px]">Principal</Badge>}</div>
                      <p className="text-xs text-muted-foreground">{k.cargo || "—"}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {k.email ? <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-muted-foreground" />{k.email}</span> : <span className="text-muted-foreground">Sin correo</span>}
                      {(k.celular || k.telefono) && <span className="flex items-center gap-1.5 text-muted-foreground"><Phone className="h-3.5 w-3.5" />{k.celular || k.telefono}</span>}
                    </TableCell>
                    <TableCell>
                      {estadoAcceso(u)}
                    </TableCell>
                    <TableCell className="text-right">
                      {puedeEditar && (
                        <div className="flex flex-wrap justify-end gap-1">
                          {!u ? (
                            <Button size="sm" variant="outline" className="gap-1.5" disabled={!k.email || trabajando === k.id} onClick={() => darAcceso(k)} title={k.email ? "" : "Agrega un correo para dar acceso"}>
                              {trabajando === k.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />} Dar acceso
                            </Button>
                          ) : (
                            <>
                              <Button size="sm" variant="outline" className="gap-1.5" disabled={trabajando === u.id} onClick={() => restablecer(u, k.nombre)}>
                                <KeyRound className="h-3.5 w-3.5" /> Restablecer clave
                              </Button>
                              <Button size="sm" variant="ghost" className="gap-1.5" disabled={trabajando === u.id} onClick={() => cambiarAcceso(u, !u.activo)}>
                                {u.activo ? <><ShieldOff className="h-3.5 w-3.5" /> Desactivar</> : <><ShieldCheck className="h-3.5 w-3.5" /> Activar</>}
                              </Button>
                            </>
                          )}
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => abrirEditar(k)}><Pencil className="h-4 w-4" /></Button>
                          {!u && <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => setABorrar(k)}><Trash2 className="h-4 w-4" /></Button>}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {sinContacto.length > 0 && (
        <div className="mt-3 rounded-lg border border-border bg-card p-3">
          <h2 className="mb-2 text-[13px] font-semibold">Otros usuarios del portal ({sinContacto.length})</h2>
          <div className="divide-y divide-border">
            {sinContacto.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>{[u.nombre, u.apellido].filter(Boolean).join(" ")} · {u.email}</span>
                <span className="flex items-center gap-2">{estadoAcceso(u)}
                  {puedeEditar && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => restablecer(u, u.nombre)}><KeyRound className="h-3.5 w-3.5" /> Restablecer clave</Button>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={formAbierto} onOpenChange={setFormAbierto}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editando ? "Editar contacto" : "Nuevo contacto"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2"><Label>Nombre y apellido *</Label><Input value={form.nombre} onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} /></div>
            <div className="col-span-2"><Label>Cargo</Label><Input value={form.cargo} onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))} placeholder="Compras, Administración…" /></div>
            <div className="col-span-2"><Label>Correo (será su usuario del portal)</Label><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            <div><Label>Teléfono</Label><Input value={form.telefono} onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} /></div>
            <div><Label>Celular</Label><Input value={form.celular} onChange={(e) => setForm((f) => ({ ...f, celular: e.target.value }))} /></div>
            <div className="col-span-2 flex items-center justify-between rounded-lg border border-border p-3">
              <Label className="cursor-pointer">Contacto principal</Label>
              <Switch checked={form.es_principal} onCheckedChange={(v) => setForm((f) => ({ ...f, es_principal: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormAbierto(false)} disabled={guardando}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando}>{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!credenciales} onOpenChange={(o) => { if (!o) setCredenciales(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{credenciales?.titulo}</DialogTitle>
            <DialogDescription>Compártela por un canal privado. Solo se muestra ahora; al entrar, el contacto deberá crear su propia contraseña.</DialogDescription>
          </DialogHeader>
          {credenciales && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border p-3 text-sm">
                <p className="text-xs text-muted-foreground">Usuario</p>
                <p className="flex items-center justify-between gap-2 font-mono">{credenciales.email}<Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copiar(credenciales.email)}><Copy className="h-3.5 w-3.5" /></Button></p>
                <p className="mt-2 text-xs text-muted-foreground">Contraseña temporal</p>
                <p className="flex items-center justify-between gap-2 font-mono text-lg">{credenciales.password}<Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copiar(credenciales.password)}><Copy className="h-3.5 w-3.5" /></Button></p>
              </div>
              <Button variant="outline" className="w-full gap-2" onClick={() => copiar(mensaje)}><Copy className="h-4 w-4" /> Copiar mensaje para enviar</Button>
            </div>
          )}
          <DialogFooter><Button onClick={() => setCredenciales(null)}>Listo</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!aBorrar} onOpenChange={(o) => { if (!o) setABorrar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar a {aBorrar?.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se elimina el contacto del cliente en GUDS.{aBorrar?.odoo_id ? " En Odoo se conserva (GUDS no borra contactos en Odoo)." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={borrar} className="bg-destructive hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
};

export default ClienteUsuarios;
