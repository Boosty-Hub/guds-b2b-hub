import { useState, useEffect } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

interface TopClient {
  id: string;
  nombre_negocio: string;
  ordenes_count: number;
  total_ventas: number;
}

export function TopClients() {
  const [clients, setClients] = useState<TopClient[]>([]);
  const [loading, setLoading] = useState(true);
  const { formatPrice } = useCurrency();

  useEffect(() => {
    fetchTopClients();
  }, []);

  const fetchTopClients = async () => {
    // Get clients with their order counts and totals
    const { data: clientesData } = await supabase
      .from('clientes')
      .select('id, nombre_negocio')
      .eq('activo', true)
      .limit(10);

    if (clientesData) {
      // Get orders for each client
      const clientsWithStats = await Promise.all(
        clientesData.map(async (cliente) => {
          const { data: ordenesData, count } = await supabase
            .from('ordenes')
            .select('total', { count: 'exact' })
            .eq('cliente_id', cliente.id);

          const totalVentas = ordenesData?.reduce((sum, o) => sum + (o.total || 0), 0) || 0;

          return {
            id: cliente.id,
            nombre_negocio: cliente.nombre_negocio,
            ordenes_count: count || 0,
            total_ventas: totalVentas,
          };
        })
      );

      // Sort by total sales and take top 5
      const sorted = clientsWithStats
        .sort((a, b) => b.total_ventas - a.total_ventas)
        .slice(0, 5);

      setClients(sorted);
    }
    setLoading(false);
  };

  const getInitials = (name: string) => {
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  };

  if (loading) {
    return (
      <div className="mb-3 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-3 py-1.5">
          <h3 className="text-[13px] font-semibold text-foreground">Mejores Clientes</h3>
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
        <h3 className="text-[13px] font-semibold text-foreground">Mejores Clientes</h3>
        <Link to="/admin/clientes" className="text-xs text-primary hover:underline">Ver todos</Link>
      </div>
      <div className="divide-y divide-border">
        {clients.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No hay clientes registrados
          </div>
        ) : (
          clients.map((client) => (
            <Link key={client.id} to={`/admin/clientes/${client.id}`} className="flex items-center gap-2 px-3 py-1 text-[13px] transition-colors hover:bg-muted/50">
              <p className="min-w-0 flex-1 truncate font-medium text-foreground" title={client.nombre_negocio}>{client.nombre_negocio}</p>
              <span className="shrink-0 text-[11px] text-muted-foreground">{client.ordenes_count} órd.</span>
              <p className="w-24 shrink-0 text-right font-semibold tabular-nums text-foreground">{formatPrice(client.total_ventas)}</p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
