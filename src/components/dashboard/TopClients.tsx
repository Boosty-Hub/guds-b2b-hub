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
      <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
        <div className="border-b border-border p-4">
          <h3 className="text-lg font-semibold text-foreground">Mejores Clientes</h3>
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
        <h3 className="text-lg font-semibold text-foreground">Mejores Clientes</h3>
        <Link to="/admin/clientes" className="text-sm text-primary hover:underline">Ver todos</Link>
      </div>
      <div className="divide-y divide-border">
        {clients.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            No hay clientes registrados
          </div>
        ) : (
          clients.map((client) => (
            <div key={client.id} className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/50">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-primary/10 text-primary font-medium">
                  {getInitials(client.nombre_negocio)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="font-medium text-foreground">{client.nombre_negocio}</p>
                <p className="text-sm text-muted-foreground">{client.ordenes_count} órdenes</p>
              </div>
              <p className="font-semibold text-foreground">{formatPrice(client.total_ventas)}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
