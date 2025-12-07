import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, Building2, MapPin, Users, Eye, Edit } from "lucide-react";

const clients = [
  { id: "CLI-001", name: "Restaurante El Buen Sabor", ruc: "20123456789", sedes: 3, users: 5, priceList: "Premium", status: "activo", balance: "-$2,450.00" },
  { id: "CLI-002", name: "Hotel Plaza Central", ruc: "20987654321", sedes: 1, users: 8, priceList: "Mayorista", status: "activo", balance: "$0.00" },
  { id: "CLI-003", name: "Cafetería Aromas", ruc: "20456789123", sedes: 5, users: 12, priceList: "Estándar", status: "activo", balance: "-$890.00" },
  { id: "CLI-004", name: "Supermercado Fresh", ruc: "20789123456", sedes: 2, users: 3, priceList: "Mayorista", status: "activo", balance: "-$5,200.00" },
  { id: "CLI-005", name: "Restaurant La Cocina", ruc: "20321654987", sedes: 1, users: 2, priceList: "Premium", status: "inactivo", balance: "$0.00" },
  { id: "CLI-006", name: "Panadería El Trigo", ruc: "20654987321", sedes: 4, users: 6, priceList: "Estándar", status: "activo", balance: "-$1,230.00" },
];

const Clientes = () => {
  return (
    <MainLayout title="Clientes">
      {/* Stats */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">156</p>
              <p className="text-sm text-muted-foreground">Total Clientes</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success/10 p-2">
              <Building2 className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold">142</p>
              <p className="text-sm text-muted-foreground">Activos</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <MapPin className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">312</p>
              <p className="text-sm text-muted-foreground">Total Sedes</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">486</p>
              <p className="text-sm text-muted-foreground">Usuarios</p>
            </div>
          </div>
        </div>
      </div>

      {/* Header Actions */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar cliente..." className="pl-9" />
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo Cliente
        </Button>
      </div>

      {/* Clients Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>RUC</TableHead>
              <TableHead className="text-center">Sedes</TableHead>
              <TableHead className="text-center">Usuarios</TableHead>
              <TableHead>Lista de Precios</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <TableRow key={client.id} className="hover:bg-muted/50">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      <AvatarFallback className="bg-primary/10 text-primary text-sm">
                        {client.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{client.name}</p>
                      <p className="text-xs text-muted-foreground">{client.id}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-sm">{client.ruc}</TableCell>
                <TableCell className="text-center">{client.sedes}</TableCell>
                <TableCell className="text-center">{client.users}</TableCell>
                <TableCell>
                  <Badge variant="outline">{client.priceList}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={client.status === "activo" ? "default" : "secondary"}>
                    {client.status === "activo" ? "Activo" : "Inactivo"}
                  </Badge>
                </TableCell>
                <TableCell className={`text-right font-semibold ${client.balance.startsWith('-') ? 'text-destructive' : ''}`}>
                  {client.balance}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Edit className="h-4 w-4" />
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

export default Clientes;
