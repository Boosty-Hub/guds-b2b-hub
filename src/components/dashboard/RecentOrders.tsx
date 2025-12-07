import { Badge } from "@/components/ui/badge";

const orders = [
  { id: "ORD-001", client: "Restaurante El Buen Sabor", total: "$2,450.00", status: "pendiente", date: "Hoy" },
  { id: "ORD-002", client: "Hotel Plaza Central", total: "$5,890.00", status: "procesando", date: "Hoy" },
  { id: "ORD-003", client: "Cafetería Aromas", total: "$890.00", status: "completado", date: "Ayer" },
  { id: "ORD-004", client: "Supermercado Fresh", total: "$12,340.00", status: "completado", date: "Ayer" },
  { id: "ORD-005", client: "Restaurant La Cocina", total: "$3,200.00", status: "enviado", date: "Hace 2 días" },
];

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  procesando: { label: "Procesando", variant: "default" },
  enviado: { label: "Enviado", variant: "outline" },
  completado: { label: "Completado", variant: "default" },
};

export function RecentOrders() {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
      <div className="border-b border-border p-4">
        <h3 className="text-lg font-semibold text-foreground">Órdenes Recientes</h3>
      </div>
      <div className="divide-y divide-border">
        {orders.map((order) => (
          <div key={order.id} className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50">
            <div className="flex-1">
              <p className="font-medium text-foreground">{order.id}</p>
              <p className="text-sm text-muted-foreground">{order.client}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-foreground">{order.total}</p>
              <p className="text-xs text-muted-foreground">{order.date}</p>
            </div>
            <div className="ml-4">
              <Badge variant={statusConfig[order.status].variant}>
                {statusConfig[order.status].label}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
