import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FlaskConical, Loader2, Tags, Users } from "lucide-react";
import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { AsignacionClientes } from "@/components/clasificacion/AsignacionClientes";
import { CatalogoClasificacion } from "@/components/clasificacion/CatalogoClasificacion";
import { cargarEstadoOdoo, cargarTipos, mensajeError, type EstadoOdooClasif, type TipoClasif } from "@/components/clasificacion/comun";

/** Configuración → Clasificación de clientes (22d): la taxonomía de finanzas (tipo → canal → categoría de cobranza), que se
 *  guarda en Odoo (Industria, Canal y Segmento de contacto) por la cola de escrituras. Pestañas: Clientes y Catálogo. */
const ConfigClasificacionClientes = () => {
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "catalogo" ? "catalogo" : "clientes";
  const [tipos, setTipos] = useState<TipoClasif[]>([]);
  const [asignados, setAsignados] = useState<Map<string, number>>(new Map());
  const [estadoOdoo, setEstadoOdoo] = useState<EstadoOdooClasif | null>(null);
  const [cargando, setCargando] = useState(true);
  const [version, setVersion] = useState(0);

  const cargar = useCallback(async () => {
    try {
      const [t, e, { data: cc, error }] = await Promise.all([
        cargarTipos(), cargarEstadoOdoo(), supabase.from("clasificacion_clientes").select("tipo_id").not("tipo_id", "is", null),
      ]);
      if (error) throw error;
      setTipos(t);
      setEstadoOdoo(e);
      const m = new Map<string, number>();
      for (const r of (cc ?? []) as { tipo_id: string }[]) m.set(r.tipo_id, (m.get(r.tipo_id) ?? 0) + 1);
      setAsignados(m);
    } catch (e) {
      toast({ title: "No se pudo cargar la clasificación", description: mensajeError(e as Error), variant: "destructive" });
    } finally {
      setCargando(false);
    }
  }, [toast]);
  useEffect(() => { cargar(); }, [cargar]);
  const refrescar = useCallback(() => { cargar(); setVersion((v) => v + 1); }, [cargar]);

  const cambiarTab = (v: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (v === "catalogo") n.set("tab", v); else n.delete("tab");
    return n;
  }, { replace: true });

  const modo = estadoOdoo?.modo ?? "simular";
  return (
    <ConfiguracionLayout title="Clasificación de clientes" description="Tipo de cliente, canal y categoría de cobranza de finanzas, guardados en Odoo">
      {modo !== "activo" && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs" data-testid="clasificacion-modo-prueba">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p><b>Modo prueba.</b> GUDS todavía no escribe la clasificación en Odoo: al enviar, registra lo que haría (valores del catálogo que crearía y
            qué tipo, canal y segmento pondría a cada cliente) para revisarlo. La escritura real se activa cuando el dueño la autorice.</p>
        </div>
      )}
      {cargando ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <Tabs value={tab} onValueChange={cambiarTab}>
          <TabsList className="mb-2">
            <TabsTrigger value="clientes" className="gap-1.5"><Users className="h-3.5 w-3.5" />Clientes</TabsTrigger>
            <TabsTrigger value="catalogo" className="gap-1.5"><Tags className="h-3.5 w-3.5" />Catálogo</TabsTrigger>
          </TabsList>
          <TabsContent value="clientes">
            <AsignacionClientes tipos={tipos} modo={modo} version={version} />
          </TabsContent>
          <TabsContent value="catalogo">
            <CatalogoClasificacion tipos={tipos} asignados={asignados} estadoOdoo={estadoOdoo} onCambio={refrescar} />
          </TabsContent>
        </Tabs>
      )}
    </ConfiguracionLayout>
  );
};

export default ConfigClasificacionClientes;
