import { useState, useEffect, useCallback } from "react";
import { DeliveryLayout } from "@/components/delivery/DeliveryLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CheckCircle, XCircle, Search, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/contexts/CurrencyContext";

interface Row {
  id: string;
  estado: string;
  fecha_entrega: string | null;
  receptor_nombre: string | null;
  motivo_fallo: string | null;
  orden?: { numero: string; total: number; cliente?: { nombre_negocio: string } | null } | null;
}

const DeliveryHistorial = () => {
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchRows = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("entregas")
      .select("id,estado,fecha_entrega,receptor_nombre,motivo_fallo,orden:ordenes(numero,total,cliente:clientes(nombre_negocio))")
      .eq("repartidor_id", user.id)
      .in("estado", ["entregada", "fallida"])
      .order("fecha_entrega", { ascending: false });
    if (data) setRows(data as unknown as Row[]);
    setLoading(false);
  }, [user?.id]);
  useEffect(() => { fetchRows(); }, [fetchRows]);

  const total = rows.length;
  const entregadas = rows.filter((r) => r.estado === "entregada").length;
  const fallidas = rows.filter((r) => r.estado === "fallida").length;
  const tasa = total > 0 ? Math.round((entregadas / total) * 100) : 0;

  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  const filtradas = rows.filter((r) =>
    (r.orden?.cliente?.nombre_negocio || "").toLowerCase().includes(search.toLowerCase()) ||
    (r.orden?.numero || "").toLowerCase().includes(search.toLowerCase()));

  return (
    <DeliveryLayout title="Historial">
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <Card className="border-border"><CardContent className="p-4"><p className="text-2xl font-bold">{total}</p><p className="text-sm text-muted-foreground">Total</p></CardContent></Card>
          <Card className="border-border"><CardContent className="p-4"><p className="text-2xl font-bold text-green-600">{entregadas}</p><p className="text-sm text-muted-foreground">Entregadas</p></CardContent></Card>
          <Card className="border-border"><CardContent className="p-4"><p className="text-2xl font-bold">{tasa}%</p><p className="text-sm text-muted-foreground">Tasa de éxito</p></CardContent></Card>
        </div>

        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por cliente u orden..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-amber-500" /></div>
        ) : filtradas.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">No hay entregas en el historial</p>
        ) : (
          <div className="space-y-3">
            {filtradas.map((r) => (
              <Card key={r.id} className="border-border"><CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {r.estado === "entregada" ? <CheckCircle className="h-5 w-5 text-green-600 shrink-0" /> : <XCircle className="h-5 w-5 text-red-600 shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.orden?.cliente?.nombre_negocio || "Cliente"}</p>
                    <p className="text-xs text-muted-foreground">{r.orden?.numero} · {fmt(r.fecha_entrega)}{r.estado === "entregada" && r.receptor_nombre ? ` · Recibió: ${r.receptor_nombre}` : ""}{r.estado === "fallida" && r.motivo_fallo ? ` · ${r.motivo_fallo}` : ""}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <Badge variant={r.estado === "entregada" ? "default" : "destructive"}>{r.estado === "entregada" ? "Entregada" : "Fallida"}</Badge>
                  <p className="text-sm font-semibold mt-1">{formatPrice(Number(r.orden?.total || 0))}</p>
                </div>
              </CardContent></Card>
            ))}
          </div>
        )}
      </div>
    </DeliveryLayout>
  );
};

export default DeliveryHistorial;
