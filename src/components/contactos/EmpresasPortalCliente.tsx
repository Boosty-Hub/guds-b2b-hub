import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionsContext";

// Empresas que se ofrecen al cliente en el portal (migración 19s). Estaba en Clientes → Contactos y acceso; ahora vive en la
// pestaña Contactos de la ficha del cliente. Solo se muestra si hay más de una empresa.
interface EmpresaPortal { empresa_id: string; empresa: string; ficha_id: string | null; habilitada: boolean; principal: boolean; usuarios: number }

export function EmpresasPortalCliente({ clienteId }: { clienteId: string }) {
  const { toast } = useToast();
  const { can } = usePermissions();
  const puedeEditar = can("clientes", "editar");
  const [empresas, setEmpresas] = useState<EmpresaPortal[]>([]);
  const [cambiando, setCambiando] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("empresas_portal_cliente", { p_cliente_id: clienteId }).then(({ data }) => setEmpresas((data as EmpresaPortal[] | null) ?? []));
  }, [clienteId]);

  const cambiar = async (e: EmpresaPortal, habilitada: boolean) => {
    setCambiando(e.empresa_id);
    const { error } = await supabase.rpc("habilitar_empresa_portal", { p_cliente_id: clienteId, p_empresa_id: e.empresa_id, p_habilitado: habilitada });
    setCambiando(null);
    if (error) { toast({ title: "No se pudo cambiar", description: error.message, variant: "destructive" }); return; }
    toast({ title: habilitada ? `${e.empresa} habilitada en el portal` : `${e.empresa} deshabilitada en el portal` });
    setEmpresas((l) => l.map((x) => (x.empresa_id === e.empresa_id ? { ...x, habilitada } : x)));
  };

  if (empresas.length < 2) return null;
  return (
    <section className="mb-2 rounded-lg border border-border bg-card p-3" aria-labelledby="empresas-portal">
      <h2 id="empresas-portal" className="text-[13px] font-semibold">Empresas en el portal</h2>
      <p className="mb-2 text-xs text-muted-foreground">
        El cliente solo ve y compra en las empresas habilitadas. Con más de una, el portal le muestra el selector de empresa.
      </p>
      <div className="flex flex-wrap gap-2">
        {empresas.map((e) => (
          <label key={e.empresa_id}
            className={`flex min-w-[200px] flex-1 items-center justify-between gap-3 rounded-md border border-border px-3 py-2 ${e.ficha_id ? "cursor-pointer" : "opacity-60"}`}
            title={!e.ficha_id ? `No es cliente de ${e.empresa} en Odoo` : e.principal ? "La empresa de esta ficha siempre está habilitada" : undefined}>
            <span className="text-sm">
              <span className="font-medium">{e.empresa}</span>
              <span className="block text-xs text-muted-foreground">
                {!e.ficha_id ? "Sin ficha en Odoo" : e.principal ? "Empresa de esta ficha" : e.habilitada ? "Habilitada" : "No habilitada"}
              </span>
            </span>
            {cambiando === e.empresa_id ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
              <Switch checked={e.habilitada} aria-label={`Portal: ${e.empresa}`} disabled={!puedeEditar || !e.ficha_id || e.principal}
                onCheckedChange={(v) => cambiar(e, v)} />
            )}
          </label>
        ))}
      </div>
    </section>
  );
}
