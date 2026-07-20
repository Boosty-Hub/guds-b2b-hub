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
      .limit(5);
    
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
      <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
        <div className="border-b border-border p-4">
          <h3 className="text-lg font-semibold text-foreground">Órdenes Recientes</h3>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
      <div className="border-b border-border p-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">Órdenes Recientes</h3>
        <Link to="/admin/ordenes" className="text-sm text-primary hover:underline">Ver todas</Link>
      </div>
      <div className="divide-y divide-border">
        {orders.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            No hay órdenes recientes
          </div>
        ) : (
          orders.map((order) => (
            <div key={order.id} className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50">
              <div className="flex-1">
                <p className="font-medium text-foreground">{order.numero}</p>
                <p className="text-sm text-muted-foreground">{order.cliente?.nombre_negocio || 'Sin cliente'}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-foreground">{formatPrice(order.total)}</p>
                <p className="text-xs text-muted-foreground">{formatDate(order.created_at)}</p>
              </div>
              <div className="ml-4">
                <Badge variant={statusConfig[order.estado]?.variant || "secondary"}>
                  {statusConfig[order.estado]?.label || order.estado}
                </Badge>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
