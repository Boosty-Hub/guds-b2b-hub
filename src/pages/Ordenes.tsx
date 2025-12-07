import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Filter, Eye, Truck } from "lucide-react";

const orders = [
  { id: "ORD-001", client: "Restaurante El Buen Sabor", sede: "Sede Norte", items: 12, total: "$2,450.00", status: "pendiente", date: "2024-01-15", delivery: "2024-01-17" },
  { id: "ORD-002", client: "Hotel Plaza Central", sede: "Hotel Principal", items: 45, total: "$5,890.00", status: "procesando", date: "2024-01-15", delivery: "2024-01-18" },
  { id: "ORD-003", client: "Cafetería Aromas", sede: "Sucursal Centro", items: 8, total: "$890.00", status: "completado", date: "2024-01-14", delivery: "2024-01-15" },
  { id: "ORD-004", client: "Supermercado Fresh", sede: "Bodega Central", items: 120, total: "$12,340.00", status: "enviado", date: "2024-01-14", delivery: "2024-01-16" },
  { id: "ORD-005", client: "Restaurant La Cocina", sede: "Local Principal", items: 25, total: "$3,200.00", status: "completado", date: "2024-01-13", delivery: "2024-01-14" },
  { id: "ORD-006", client: "Panadería El Trigo", sede: "Fábrica", items: 35, total: "$4,560.00", status: "pendiente", date: "2024-01-15", delivery: "2024-01-17" },
  { id: "ORD-007", client: "Comedor Industrial ABC", sede: "Planta Norte", items: 80, total: "$9,870.00", status: "procesando", date: "2024-01-15", delivery: "2024-01-18" },
];

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  procesando: { label: "Procesando", variant: "default" },
  enviado: { label: "Enviado", variant: "outline" },
  completado: { label: "Completado", variant: "default" },
};

const Ordenes = () => {
  return (
    <MainLayout title="Órdenes">
      {/* Header Actions */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por ID, cliente..." className="pl-9" />
          </div>
          <Select defaultValue="all">
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pendiente">Pendiente</SelectItem>
              <SelectItem value="procesando">Procesando</SelectItem>
              <SelectItem value="enviado">Enviado</SelectItem>
              <SelectItem value="completado">Completado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Nueva Orden
        </Button>
      </div>

      {/* Orders Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Sede</TableHead>
              <TableHead className="text-center">Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Fecha Pedido</TableHead>
              <TableHead>Entrega</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow key={order.id} className="hover:bg-muted/50">
                <TableCell className="font-medium text-primary">{order.id}</TableCell>
                <TableCell className="font-medium">{order.client}</TableCell>
                <TableCell className="text-muted-foreground">{order.sede}</TableCell>
                <TableCell className="text-center">{order.items}</TableCell>
                <TableCell className="text-right font-semibold">{order.total}</TableCell>
                <TableCell>
                  <Badge variant={statusConfig[order.status].variant}>
                    {statusConfig[order.status].label}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{order.date}</TableCell>
                <TableCell className="text-muted-foreground">{order.delivery}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Truck className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </MainLayout>
  );
};

export default Ordenes;
