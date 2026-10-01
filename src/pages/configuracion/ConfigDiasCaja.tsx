import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Loader2 } from "lucide-react";
import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { DIAS_SEMANA, cargarDiasCaja, fmtFechaCorta, mensajeError, proximoDiaCaja } from "@/components/planificacion-pagos/comun";

/** Configuración → Días de caja (21c): el día de la semana en que cada empresa paga a sus proveedores. */
const ConfigDiasCaja = () => {
  const { toast } = useToast();
  const { empresas } = useEmpresa();
  const { can } = usePermissions();
  const puedeEditar = can("configuracion", "editar");
  const [dias, setDias] = useState<Record<string, number>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);

  useEffect(() => { cargarDiasCaja().then((d) => { setDias(d); setCargando(false); }); }, []);

  const cambiar = async (empresaId: string, dia: number) => {
    const antes = dias[empresaId];
    setDias((d) => ({ ...d, [empresaId]: dia }));
    setGuardando(empresaId);
    const { error } = await supabase.rpc("fijar_dia_caja", { p_empresa: empresaId, p_dia: dia, p_tipo: "proveedores" });
    setGuardando(null);
    if (error) {
      setDias((d) => ({ ...d, [empresaId]: antes }));
      toast({ title: "No se pudo guardar", description: mensajeError(error), variant: "destructive" });
      return;
    }
    toast({ title: "Día de caja guardado", description: `${empresas.find((e) => e.id === empresaId)?.nombre_corto}: ${DIAS_SEMANA[dia]}` });
  };

  return (
    <ConfiguracionLayout title="Días de caja" description="Día de la semana en que cada empresa paga a sus proveedores">
      <Card className="max-w-2xl border-border">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4 text-primary" />Pago a proveedores</CardTitle>
          <CardDescription>
            La planificación de pagos (<Link to="/admin/cuentas-por-pagar?tab=planificacion" className="text-primary hover:underline">Cuentas por Pagar → Planificación</Link>)
            propone como fecha de corte el próximo día de caja de la empresa activa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cargando ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : (
            <div className="divide-y divide-border rounded-md border border-border">
              {empresas.map((e) => {
                const dia = dias[e.id] ?? 3;
                return (
                  <div key={e.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-empresa={e.id}>
                    <Label htmlFor={`dia-${e.id}`} className="min-w-[110px] font-medium">{e.nombre_corto}</Label>
                    <select id={`dia-${e.id}`} value={dia} disabled={!puedeEditar || guardando === e.id}
                      onChange={(ev) => cambiar(e.id, Number(ev.target.value))}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm capitalize">
                      {DIAS_SEMANA.map((d, i) => <option key={d} value={i}>{d}</option>)}
                    </select>
                    {guardando === e.id && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                    <span className="text-xs text-muted-foreground sm:ml-auto">Próximo: {fmtFechaCorta(proximoDiaCaja(dia))}</span>
                  </div>
                );
              })}
            </div>
          )}
          {!puedeEditar && <p className="mt-2 text-xs text-muted-foreground">Solo lectura: tu rol no tiene permiso para editar la configuración.</p>}
        </CardContent>
      </Card>
    </ConfiguracionLayout>
  );
};

export default ConfigDiasCaja;
