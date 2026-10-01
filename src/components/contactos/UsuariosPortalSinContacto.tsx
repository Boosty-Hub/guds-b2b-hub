import { useCallback, useEffect, useState } from "react";
import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionsContext";
import { AccesoPortalDialog, CredencialesDialog, type Credenciales } from "./AccesoPortalDialog";
import { EstadoAccesoBadge } from "./EstadoAccesoBadge";

interface UsuarioPortal { id: string; email: string; nombre: string; apellido: string | null; activo: boolean; debe_cambiar_clave: boolean }

/** Usuarios del portal de un cliente que no están ligados a un contacto (p. ej. los del registro público aprobado). */
export function UsuariosPortalSinContacto({ clienteId }: { clienteId: string }) {
  const { toast } = useToast();
  const { can } = usePermissions();
  const puedeEditar = can("clientes", "editar") || can("contactos", "editar");
  const [usuarios, setUsuarios] = useState<UsuarioPortal[]>([]);
  const [clave, setClave] = useState<UsuarioPortal | null>(null);
  const [credenciales, setCredenciales] = useState<Credenciales | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase.from("usuarios").select("id, email, nombre, apellido, activo, debe_cambiar_clave")
      .eq("cliente_id", clienteId).eq("role", "cliente").is("contacto_id", null);
    setUsuarios((data as UsuarioPortal[] | null) ?? []);
  }, [clienteId]);
  useEffect(() => { cargar(); }, [cargar]);

  const cambiar = async (u: UsuarioPortal, activo: boolean) => {
    const { error } = await supabase.rpc("cambiar_acceso_cliente", { p_usuario_id: u.id, p_activo: activo });
    if (error) { toast({ title: "No se pudo cambiar el acceso", description: error.message, variant: "destructive" }); return; }
    toast({ title: activo ? "Acceso reactivado" : "Acceso desactivado", description: u.email });
    cargar();
  };

  if (!usuarios.length) return null;
  return (
    <section className="mt-2 rounded-lg border border-border bg-card p-3">
      <h2 className="mb-1 text-[13px] font-semibold">Otros usuarios del portal ({usuarios.length})</h2>
      <p className="mb-2 text-xs text-muted-foreground">Entran al portal de este cliente sin estar ligados a un contacto (por ejemplo, los del registro público).</p>
      <div className="divide-y divide-border">
        {usuarios.map((u) => (
          <div key={u.id} className="flex flex-col gap-2 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 break-all">{[u.nombre, u.apellido].filter(Boolean).join(" ")} · {u.email}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <EstadoAccesoBadge estado={!u.activo ? "desactivado" : u.debe_cambiar_clave ? "temporal" : "activo"} />
              {puedeEditar && (
                <>
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setClave(u)}><KeyRound className="h-3.5 w-3.5" /> Cambiar contraseña</Button>
                  <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={() => cambiar(u, !u.activo)}>
                    {u.activo ? <><ShieldOff className="h-3.5 w-3.5" /> Desactivar</> : <><ShieldCheck className="h-3.5 w-3.5" /> Activar</>}
                  </Button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
      {clave && (
        <AccesoPortalDialog open={!!clave} onOpenChange={(v) => { if (!v) setClave(null); }} usuarioId={clave.id}
          contacto={{ id: "", nombre: [clave.nombre, clave.apellido].filter(Boolean).join(" "), email: clave.email }}
          onHecho={(c) => { setCredenciales(c); cargar(); }} />
      )}
      <CredencialesDialog credenciales={credenciales} onClose={() => setCredenciales(null)} />
    </section>
  );
}
