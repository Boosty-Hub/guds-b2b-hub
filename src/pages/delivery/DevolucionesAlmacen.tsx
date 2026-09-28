import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Loader2, PackageCheck } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useToast } from "@/hooks/use-toast";
import { IncidenciasPanel } from "@/components/delivery/IncidenciasPanel";
import { cargarIncidencias, type Incidencia } from "@/components/delivery/seguimiento";

// Devoluciones de ruta para el almacén (D6, fase 20p): lo que no se entregó (entregas incompletas o rechazadas) vuelve al
// almacén y aquí se confirma lo recibido por producto (queda quién y cuándo). La abre el personal con delivery o con
// inventario; el aviso "Devolución por confirmar" trae aquí. No escribe en Odoo: la devolución se registra allá.
const DevolucionesAlmacen = () => {
  const { can, loading: cargandoPermisos } = usePermissions();
  const { toast } = useToast();
  const [items, setItems] = useState<Incidencia[]>([]);
  const [cargando, setCargando] = useState(true);
  const permitido = can("delivery", "ver") || can("inventario", "ver");

  const cargar = useCallback(async () => {
    setCargando(true);
    try { setItems(await cargarIncidencias(true, 90)); }
    catch (e) { toast({ title: "No se pudieron cargar las devoluciones", description: (e as Error).message, variant: "destructive" }); }
    finally { setCargando(false); }
  }, [toast]);
  useEffect(() => { if (!cargandoPermisos && permitido) cargar(); }, [cargandoPermisos, permitido, cargar]);

  if (cargandoPermisos) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!permitido) return <Navigate to="/admin/dashboard" replace />;

  return (
    <MainLayout title="Devoluciones de ruta">
      <p className="mb-2 flex items-start gap-2 text-xs text-muted-foreground">
        <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        Mercancía que regresa de las entregas incompletas o rechazadas. Cuenta lo que llegó al almacén y confírmalo por producto; si falta algo, deja una nota.
        La devolución en Odoo se registra allá.
      </p>
      <IncidenciasPanel modo="almacen" incidencias={items} cargando={cargando} puedeDecidir={false}
        puedeConfirmar={can("delivery", "editar") || can("inventario", "editar")} onCambio={cargar} />
    </MainLayout>
  );
};

export default DevolucionesAlmacen;
