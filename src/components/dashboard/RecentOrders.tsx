import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

interface OrdenReciente {
  id: string;
  numero: string;
  total: number;
  estado: string;
  created_at: string;
  cliente: {
    nombre_negocio: string;
  } | null;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  confirmado: { label: "Confirmado", variant: "default" },
  procesando: { label: "Procesando", variant: "default" },
  enviado: { label: "Enviado", variant: "outline" },
  completado: { label: "Completado", variant: "default" },
  cancelado: { label: "Cancelado", variant: "destructive" },
};

export function RecentOrders() {
  const [orders, setOrders] = useState<OrdenReciente[]>([]);
  const [loading, setLoading] = useState(true);
  const { formatPrice } = useCurrency();

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    const { data } = await supabase
      .from('ordenes')
      .select('id, numero, total, estado, created_at, cliente:clientes(nombre_negocio)')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (data) {
      // Transform data to match interface (cliente comes as object, not array)
      const transformed = data.map(order => ({
        ...order,
        cliente: Array.isArray(order.cliente) ? order.cliente[0] : order.cliente
      }));
      setOrders(transformed);
    }
    setLoading(false);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "Hoy";
    if (diffDays === 1) return "Ayer";
    return `Hace ${diffDays} días`;
  };

  if (loading) {
    return (
      <div className="mb-3 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-3 py-1.5">
          <h3 className="text-[13px] font-semibold text-foreground">Órdenes Recientes</h3>
        </div>
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-border bg-card">
      <div className="border-b border-border bg-muted/30 px-3 py-1.5 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-foreground">Órdenes Recientes</h3>
        <Link to="/admin/ordenes" className="text-xs text-primary hover:underline">Ver todas</Link>
      </div>
      <div className="divide-y divide-border">
        {orders.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No hay órdenes recientes
          </div>
        ) : (
          orders.map((order) => (
            <Link key={order.id} to={`/admin/ordenes?orden=${order.id}`} className="flex items-center gap-2 px-3 py-1 text-[13px] transition-colors hover:bg-muted/50">
              <span className="w-14 shrink-0 font-medium text-primary">{order.numero}</span>
              <span className="min-w-0 flex-1 truncate" title={order.cliente?.nombre_negocio || undefined}>{order.cliente?.nombre_negocio || 'Sin cliente'}</span>
              <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">{formatDate(order.created_at)}</span>
              <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{formatPrice(order.total)}</span>
              <Badge variant={statusConfig[order.estado]?.variant || "secondary"} className="shrink-0">
                {statusConfig[order.estado]?.label || order.estado}
              </Badge>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
