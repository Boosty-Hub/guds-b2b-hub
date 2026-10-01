import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, KeyRound, Loader2, Pencil, Send, ShieldCheck, ShieldOff, Trash2, Truck, UserPlus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FichaCampos, Panel } from "@/components/datos/FichaCampos";
import { OdooBadge } from "@/components/OdooBadge";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { AccesoPortalDialog, CredencialesDialog, type Credenciales } from "./AccesoPortalDialog";
import { ContactoFormDialog } from "./ContactoFormDialog";
import { EstadoAccesoBadge } from "./EstadoAccesoBadge";
import {
  SELECT_CONTACTO, cargarAccesos, enlaceVinculo, estadoAcceso, fechaHora, nombreVinculo, tipoVinculo, type AccesoPortal, type Contacto,
} from "./tipos";

interface EnvioOdoo { id: string; estado: string; error: string | null; datos: { accion?: string } | null; resultado: { omitida?: string } | null; created_at: string }

const ESTADO_ENVIO: Record<string, { texto: string; clase: string }> = {
  pendiente: { texto: "Enviando…", clase: "text-primary" }, procesando: { texto: "Enviando…", clase: "text-primary" },
  hecha: { texto: "Enviado", clase: "text-success" }, simulada: { texto: "Simulado (modo simular)", clase: "text-warning" },
  error: { texto: "Error", clase: "text-destructive" },
};

/**
 * Ficha de un contacto en una hoja lateral: datos, a quién pertenece, acceso al portal (dar acceso, cambiar contraseña,
 * activar o desactivar) y su envío a Odoo. `onCambio` avisa a la lista para recargar.
 */
export function ContactoHoja({ contactoId, onClose, onCambio }: { contactoId: string | null; onClose: () => void; onCambio?: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { can } = usePermissions();
  const { empresas, soloLectura } = useEmpresa();
  const [k, setK] = useState<Contacto | null>(null);
  const [acceso, setAcceso] = useState<AccesoPortal | null>(null);
  const [envios, setEnvios] = useState<EnvioOdoo[]>([]);
  const [cargando, setCargando] = useState(false);
  const [editar, setEditar] = useState(false);
  const [accesoDialogo, setAccesoDialogo] = useState<"dar" | "clave" | null>(null);
  const [credenciales, setCredenciales] = useState<Credenciales | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [borrar, setBorrar] = useState(false);
  const personalAdmin = user?.role === "admin";

  const cargar = useCallback(async () => {
    if (!contactoId) return;
    setCargando(true);
    const [{ data }, accesos, { data: env }] = await Promise.all([
      supabase.from("cliente_contactos").select(SELECT_CONTACTO).eq("id", contactoId).maybeSingle(),
      cargarAccesos(),
      personalAdmin
        ? supabase.from("odoo_escrituras").select("id, estado, error, datos, resultado, created_at").eq("tipo", "persona_contacto").eq("referencia_id", contactoId)
          .order("created_at", { ascending: false }).limit(3)
        : Promise.resolve({ data: [] }),
    ]);
    setK((data as unknown as Contacto | null) ?? null);
    setAcceso(accesos.get(contactoId) ?? null);
    setEnvios((env as EnvioOdoo[] | null) ?? []);
    setCargando(false);
  }, [contactoId, personalAdmin]);
  useEffect(() => { if (contactoId) cargar(); else { setK(null); setAcceso(null); setEnvios([]); } }, [contactoId, cargar]);

  const recargar = () => { cargar(); onCambio?.(); };
  const tipo = k ? tipoVinculo(k) : "suelto";
  const puedeEditar = !soloLectura && (tipo === "cliente" ? can("clientes", "editar") || can("contactos", "editar")
    : tipo === "proveedor" ? personalAdmin && (can("compras", "editar") || can("contactos", "editar")) : personalAdmin && can("contactos", "editar"));
  const estado = estadoAcceso(acceso, k ?? undefined);
  const accesoDeOtroCliente = !!acceso && !!k && acceso.cliente_id !== k.cliente_id;
  const padreOdoo = k?.cliente?.odoo_id ?? k?.proveedor?.odoo_id ?? null;
  const ultimoEnvio = envios.find((e) => e.datos?.accion !== "desligar") ?? null;
  const puedeEnviarOdoo = personalAdmin && puedeEditar && k?.origen === "guds" && tipo !== "suelto" && !!padreOdoo && k.activo
    && (!ultimoEnvio || ["error", "simulada"].includes(ultimoEnvio.estado) || !!ultimoEnvio.resultado?.omitida) && !(k.odoo_id && ultimoEnvio?.estado === "hecha");
  const empresa = empresas.find((e) => e.id === k?.empresa_id);

  const cambiarAcceso = async (activo: boolean) => {
    if (!acceso) return;
    setTrabajando(true);
    const { error } = await supabase.rpc("cambiar_acceso_cliente", { p_usuario_id: acceso.usuario_id, p_activo: activo });
    setTrabajando(false);
    if (error) { toast({ title: "No se pudo cambiar el acceso", description: error.message, variant: "destructive" }); return; }
    toast({ title: activo ? "Acceso reactivado" : "Acceso desactivado", description: acceso.email });
    recargar();
  };
  const enviarOdoo = async () => {
    if (!k) return;
    setTrabajando(true);
    const { error } = await supabase.rpc("enviar_contacto_odoo", { p_contacto_id: k.id });
    setTrabajando(false);
    if (error) { toast({ title: "No se pudo enviar a Odoo", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Enviado a la cola de Odoo", description: "Se procesa en unos segundos." });
    setTimeout(cargar, 2500);
  };
  const eliminar = async () => {
    if (!k) return;
    const { error } = await supabase.from("cliente_contactos").delete().eq("id", k.id);
    setBorrar(false);
    if (error) { toast({ title: "No se pudo eliminar", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Contacto eliminado", description: k.nombre });
    onCambio?.();
    onClose();
  };

  const Icono = tipo === "cliente" ? Building2 : tipo === "proveedor" ? Truck : UserRound;
  const enlace = k ? enlaceVinculo(k) : null;

  return (
    <>
      <Sheet open={!!contactoId} onOpenChange={(o) => { if (!o) onClose(); }}>
        <SheetContent className="w-full overflow-y-auto p-4 sm:max-w-lg" data-testid="hoja-contacto">
          {cargando && !k ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : !k ? (
            <SheetHeader><SheetTitle>Contacto no encontrado</SheetTitle><SheetDescription>No existe o no tienes permiso para verlo.</SheetDescription></SheetHeader>
          ) : (
            <>
              <SheetHeader className="mb-3 space-y-1 pr-6 text-left">
                <SheetTitle className="flex flex-wrap items-center gap-2 text-base">
                  {k.nombre}
                  {k.origen === "odoo" && <OdooBadge sincronizado={k.odoo_sync_at} />}
                  {k.es_principal && <Badge variant="secondary" className="text-[10px]">Principal</Badge>}
                  {!k.activo && <Badge variant="outline" className="text-[10px]">Inactivo</Badge>}
                </SheetTitle>
                <SheetDescription className="flex flex-wrap items-center gap-1.5">
                  <Icono className="h-3.5 w-3.5" />
                  {tipo === "suelto" ? "Contacto suelto (sin cliente ni proveedor)" : (
                    <>{tipo === "cliente" ? "Cliente" : "Proveedor"}:{" "}
                      {enlace ? <Link to={enlace} className="font-medium text-primary hover:underline" onClick={onClose}>{nombreVinculo(k) ?? "ver ficha"}</Link> : nombreVinculo(k)}</>
                  )}
                </SheetDescription>
              </SheetHeader>

              {puedeEditar && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setEditar(true)}><Pencil className="h-3.5 w-3.5" /> Editar</Button>
                  {k.origen === "guds" && !acceso && (
                    <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-destructive hover:bg-destructive/10" onClick={() => setBorrar(true)}><Trash2 className="h-3.5 w-3.5" /> Eliminar</Button>
                  )}
                </div>
              )}

              <Panel titulo="Datos">
                <FichaCampos columnas={3} campos={[
                  { label: "Cargo", valor: k.cargo, odoo: k.origen === "odoo" },
                  { label: "Correo", valor: k.email ? <a href={`mailto:${k.email}`} className="break-all text-primary hover:underline">{k.email}</a> : null, odoo: k.origen === "odoo", ancho: 2 },
                  { label: "Teléfono", valor: k.telefono, odoo: k.origen === "odoo" },
                  { label: "Celular", valor: k.celular, odoo: k.origen === "odoo" },
                  { label: "Empresa", valor: empresa?.nombre_corto ?? (k.empresa_id ? null : "Compartido") },
                  { label: "Origen", valor: k.origen === "odoo" ? `Odoo #${k.odoo_id}` : k.odoo_id ? `GUDS · en Odoo #${k.odoo_id}` : "GUDS" },
                  { label: "Creado", valor: fechaHora(k.created_at) },
                  { label: "Actualizado", valor: fechaHora(k.updated_at) },
                  ...(k.notas ? [{ label: "Notas internas", valor: k.notas, ancho: 3 as const }] : []),
                ]} />
              </Panel>

              <Panel titulo="Acceso al portal de clientes" acciones={<EstadoAccesoBadge estado={estado} />}>
                {tipo !== "cliente" ? (
                  <p className="text-[13px] text-muted-foreground">
                    Solo los contactos de un cliente pueden entrar al portal.
                    {acceso && <> Tenía usuario ({acceso.email}); quedó desactivado al quitarle el cliente.</>}
                  </p>
                ) : !k.email ? (
                  <p className="text-[13px] text-muted-foreground">Agrega un correo al contacto para darle acceso: será su usuario.</p>
                ) : (
                  <div className="space-y-2 text-[13px]">
                    {acceso ? (
                      <p>Usuario <span className="font-medium">{acceso.email}</span>
                        {acceso.ultimo_ingreso ? <span className="text-muted-foreground"> · último ingreso {fechaHora(acceso.ultimo_ingreso)}</span> : <span className="text-muted-foreground"> · aún no ha entrado</span>}
                        {accesoDeOtroCliente && <span className="block text-xs text-warning">Su acceso era de otro cliente: dale acceso de nuevo para este.</span>}
                      </p>
                    ) : <p className="text-muted-foreground">Aún no tiene acceso. Entrará con {k.email}.</p>}
                    {puedeEditar && !k.activo && <p className="text-xs text-muted-foreground">El contacto está inactivo: actívalo para darle acceso.</p>}
                    {puedeEditar && k.activo && (
                      <div className="flex flex-wrap gap-1.5">
                        {(!acceso || accesoDeOtroCliente) && (
                          <Button size="sm" className="h-8 gap-1.5" onClick={() => setAccesoDialogo("dar")} data-testid="dar-acceso"><UserPlus className="h-3.5 w-3.5" /> Dar acceso</Button>
                        )}
                        {acceso && !accesoDeOtroCliente && (
                          <>
                            <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={trabajando} onClick={() => setAccesoDialogo("clave")}><KeyRound className="h-3.5 w-3.5" /> Cambiar contraseña</Button>
                            {acceso.activo
                              ? <Button size="sm" variant="ghost" className="h-8 gap-1.5" disabled={trabajando} onClick={() => cambiarAcceso(false)}><ShieldOff className="h-3.5 w-3.5" /> Desactivar</Button>
                              : <Button size="sm" variant="ghost" className="h-8 gap-1.5" disabled={trabajando} onClick={() => cambiarAcceso(true)}><ShieldCheck className="h-3.5 w-3.5" /> Activar</Button>}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </Panel>

              {personalAdmin && (
                <Panel titulo={<>Odoo {k.origen === "odoo" && <OdooBadge />}</>}>
                  <div className="space-y-1.5 text-[13px]">
                    {k.origen === "odoo" ? (
                      <p className="text-muted-foreground">Viene de Odoo (#{k.odoo_id}){k.odoo_padre_id ? ", como contacto de su empresa" : ", sin empresa"}: sus datos se editan en Odoo.</p>
                    ) : tipo === "suelto" ? (
                      <p className="text-muted-foreground">Un contacto suelto vive solo en GUDS: no se envía a Odoo.</p>
                    ) : !padreOdoo ? (
                      <p className="text-muted-foreground">Su {tipo} aún no está en Odoo: el contacto se envía cuando quede vinculado.</p>
                    ) : (
                      <>
                        <p>{k.odoo_id ? <span className="text-success">En Odoo (#{k.odoo_id}), marcado "(GUDS)".</span> : <span className="text-muted-foreground">Aún no está en Odoo.</span>}
                          {ultimoEnvio && (
                            <span className="block text-xs text-muted-foreground">
                              Último envío ({ultimoEnvio.datos?.accion ?? "—"}, {fechaHora(ultimoEnvio.created_at)}):{" "}
                              <span className={ESTADO_ENVIO[ultimoEnvio.estado]?.clase}>{ultimoEnvio.resultado?.omitida ? `omitido: ${ultimoEnvio.resultado.omitida}` : ESTADO_ENVIO[ultimoEnvio.estado]?.texto ?? ultimoEnvio.estado}</span>
                              {ultimoEnvio.error && <span className="block text-destructive">{ultimoEnvio.error}</span>}
                            </span>
                          )}
                        </p>
                        {puedeEnviarOdoo && (
                          <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={trabajando} onClick={enviarOdoo}><Send className="h-3.5 w-3.5" /> {k.odoo_id ? "Reenviar datos a Odoo" : "Enviar a Odoo"}</Button>
                        )}
                      </>
                    )}
                    {envios.some((e) => e.datos?.accion === "desligar") && (
                      <p className="text-xs text-muted-foreground">Cambió de {tipo === "suelto" ? "empresa" : tipo}: en Odoo el registro anterior se conserva con una nota "(GUDS)".</p>
                    )}
                  </div>
                </Panel>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {k && (
        <>
          <ContactoFormDialog open={editar} onOpenChange={setEditar} contacto={k} acceso={acceso} onGuardado={recargar} />
          <AccesoPortalDialog open={!!accesoDialogo} onOpenChange={(v) => { if (!v) setAccesoDialogo(null); }}
            contacto={{ id: k.id, nombre: k.nombre, email: k.email }} usuarioId={accesoDialogo === "clave" ? acceso?.usuario_id : null}
            onHecho={(c) => { setCredenciales(c); recargar(); }} />
        </>
      )}
      <CredencialesDialog credenciales={credenciales} onClose={() => setCredenciales(null)} />
      <AlertDialog open={borrar} onOpenChange={setBorrar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar a {k?.nombre}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se elimina el contacto en GUDS.{k?.odoo_id ? " En Odoo se conserva (GUDS no borra contactos en Odoo)." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={eliminar} className="bg-destructive hover:bg-destructive/90">Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
