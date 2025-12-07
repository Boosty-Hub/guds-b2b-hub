import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const clients = [
  { name: "Hotel Plaza Central", orders: 45, revenue: "$125,400" },
  { name: "Supermercado Fresh", orders: 38, revenue: "$98,200" },
  { name: "Restaurante El Buen Sabor", orders: 32, revenue: "$67,800" },
  { name: "Cafetería Aromas", orders: 28, revenue: "$45,600" },
  { name: "Restaurant La Cocina", orders: 24, revenue: "$38,900" },
];

export function TopClients() {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
      <div className="border-b border-border p-4">
        <h3 className="text-lg font-semibold text-foreground">Mejores Clientes</h3>
      </div>
      <div className="divide-y divide-border">
        {clients.map((client, index) => (
          <div key={client.name} className="flex items-center gap-4 p-4 transition-colors hover:bg-muted/50">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-primary/10 text-primary font-medium">
                {client.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <p className="font-medium text-foreground">{client.name}</p>
              <p className="text-sm text-muted-foreground">{client.orders} órdenes</p>
            </div>
            <p className="font-semibold text-foreground">{client.revenue}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
