import { useState } from "react";
import { DeliveryLayout } from "@/components/delivery/DeliveryLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CalendarClock, CheckCircle, PackageMinus, Search, Loader2, XCircle, Ban } from "lucide-react";
import { fechaHora } from "@/components/delivery/fechas";
import { useMisEntregas } from "@/components/delivery/useMisEntregas";
import { ABIERTAS, ESTADO_ENTREGA, etiquetaMotivo, fmtDia } from "@/components/delivery/entregas";

const ICONO: Record<string, JSX.Element> = {
  entregada: <CheckCircle className="h-5 w-5 shrink-0 text-green-600" />,
  incompleta: <PackageMinus className="h-5 w-5 shrink-0 text-amber-600" />,
  rechazada: <XCircle className="h-5 w-5 shrink-0 text-red-600" />,
  fallida: <XCircle className="h-5 w-5 shrink-0 text-red-600" />,
  reprogramada: <CalendarClock className="h-5 w-5 shrink-0 text-sky-600" />,
  cancelada: <Ban className="h-5 w-5 shrink-0 text-muted-foreground" />,
};

// Historial del repartidor: entregas cerradas de los últimos 90 días con su resultado.
const DeliveryHistorial = () => {
  const { entregas, loading } = useMisEntregas(90);
  const [search, setSearch] = useState("");
  const rows = entregas.filter((e) => !ABIERTAS.includes(e.estado));

  const total = rows.filter((r) => r.estado !== "cancelada").length;
  const entregadas = rows.filter((r) => r.estado === "entregada" || r.estado === "incompleta").length;
  const tasa = total > 0 ? Math.round((entregadas / total) * 100) : 0;

  const t = search.toLowerCase();
  const filtradas = rows.filter((r) => [r.cliente, r.contacto, r.numero, r.origen].some((v) => (v || "").toLowerCase().includes(t)));

  return (
    <DeliveryLayout title="Historial">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-border"><CardContent className="p-3"><p className="text-2xl font-bold">{total}</p><p className="text-xs text-muted-foreground">Cerradas</p></CardContent></Card>
          <Card className="border-border"><CardContent className="p-3"><p className="text-2xl font-bold text-green-600">{entregadas}</p><p className="text-xs text-muted-foreground">Entregadas</p></CardContent></Card>
          <Card className="border-border"><CardContent className="p-3"><p className="text-2xl font-bold">{tasa}%</p><p className="text-xs text-muted-foreground">Tasa de entrega</p></CardContent></Card>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por cliente o documento..." className="h-11 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>
        ) : filtradas.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">No hay entregas en el historial</p>
        ) : (
          <div className="space-y-2">
            {filtradas.map((r) => {
              const est = ESTADO_ENTREGA[r.estado] ?? { label: r.estado, cls: "" };
              return (
                <Card key={r.id} className="border-border"><CardContent className="flex items-start justify-between gap-3 p-3">
                  <div className="flex min-w-0 items-start gap-3">
                    {ICONO[r.estado] ?? ICONO.cancelada}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.contacto || r.cliente || "Cliente"}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="font-mono">{r.numero}</span> · {fechaHora(r.fecha_cierre || r.fecha_entrega)}
                        {r.receptor_nombre && (r.estado === "entregada" || r.estado === "incompleta") ? ` · Recibió: ${r.receptor_nombre}` : ""}
                      </p>
                      {(r.motivo_codigo || r.motivo_detalle) && (
                        <p className="text-xs text-muted-foreground">{r.motivo_codigo ? etiquetaMotivo(r.motivo_codigo) : ""}{r.motivo_detalle ? `${r.motivo_codigo ? " — " : ""}${r.motivo_detalle}` : ""}</p>
                      )}
                      {r.reprogramada_para && <p className="text-xs text-sky-700 dark:text-sky-300">Nueva fecha: {fmtDia(r.reprogramada_para)}</p>}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="outline" className={`whitespace-nowrap font-normal ${est.cls}`}>{est.label}</Badge>
                    {r.origen_cierre === "odoo" && <span className="text-[10px] text-[#714B67] dark:text-[#d7b6cf]">Actualizado desde Odoo</span>}
                  </div>
                </CardContent></Card>
              );
            })}
          </div>
        )}
      </div>
    </DeliveryLayout>
  );
};

export default DeliveryHistorial;
