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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, ArrowUpRight, ArrowDownLeft, Package, Warehouse } from "lucide-react";

const inventory = [
  { sku: "ARR-001", name: "Arroz Premium 50kg", warehouse: "Bodega Central", stock: 250, minStock: 50, maxStock: 500, lastMovement: "2024-01-15" },
  { sku: "ACE-001", name: "Aceite Vegetal 20L", warehouse: "Bodega Central", stock: 180, minStock: 30, maxStock: 300, lastMovement: "2024-01-14" },
  { sku: "AZU-001", name: "Azúcar Blanca 50kg", warehouse: "Bodega Central", stock: 15, minStock: 40, maxStock: 400, lastMovement: "2024-01-15" },
  { sku: "HAR-001", name: "Harina de Trigo 50kg", warehouse: "Bodega Norte", stock: 320, minStock: 60, maxStock: 500, lastMovement: "2024-01-13" },
  { sku: "SAL-001", name: "Sal Yodada 25kg", warehouse: "Bodega Central", stock: 0, minStock: 20, maxStock: 200, lastMovement: "2024-01-10" },
];

const movements = [
  { id: "MOV-001", date: "2024-01-15 14:30", type: "entrada", product: "Arroz Premium 50kg", quantity: 100, warehouse: "Bodega Central", reference: "COMP-0125", user: "Juan Pérez" },
  { id: "MOV-002", date: "2024-01-15 11:20", type: "salida", product: "Aceite Vegetal 20L", quantity: 45, warehouse: "Bodega Central", reference: "ORD-002", user: "María García" },
  { id: "MOV-003", date: "2024-01-15 09:45", type: "entrada", product: "Azúcar Blanca 50kg", quantity: 50, warehouse: "Bodega Central", reference: "COMP-0124", user: "Juan Pérez" },
  { id: "MOV-004", date: "2024-01-14 16:00", type: "salida", product: "Harina de Trigo 50kg", quantity: 80, warehouse: "Bodega Norte", reference: "ORD-001", user: "Carlos López" },
  { id: "MOV-005", date: "2024-01-14 10:30", type: "transferencia", product: "Sal Yodada 25kg", quantity: 20, warehouse: "Bodega Central → Norte", reference: "TRF-0012", user: "Ana Martínez" },
];

const Inventario = () => {
  return (
    <MainLayout title="Inventario">
      {/* Stats */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Warehouse className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">3</p>
              <p className="text-sm text-muted-foreground">Bodegas</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success/10 p-2">
              <ArrowUpRight className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold">156</p>
              <p className="text-sm text-muted-foreground">Entradas Hoy</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-destructive/10 p-2">
              <ArrowDownLeft className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">89</p>
              <p className="text-sm text-muted-foreground">Salidas Hoy</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2">
              <Package className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold">23</p>
              <p className="text-sm text-muted-foreground">Bajo Mínimo</p>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="stock" className="space-y-6">
        <TabsList>
          <TabsTrigger value="stock">Stock Actual</TabsTrigger>
          <TabsTrigger value="movements">Movimientos</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="space-y-4">
          {/* Header Actions */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar producto..." className="pl-9" />
              </div>
              <Select defaultValue="all">
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Bodega" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las bodegas</SelectItem>
                  <SelectItem value="central">Bodega Central</SelectItem>
                  <SelectItem value="norte">Bodega Norte</SelectItem>
                  <SelectItem value="sur">Bodega Sur</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Ajuste de Inventario
            </Button>
          </div>

          {/* Inventory Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Bodega</TableHead>
                  <TableHead className="text-center">Stock</TableHead>
                  <TableHead className="text-center">Mínimo</TableHead>
                  <TableHead className="text-center">Máximo</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Último Mov.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inventory.map((item) => {
                  const status = item.stock === 0 ? "agotado" : item.stock < item.minStock ? "bajo" : "ok";
                  return (
                    <TableRow key={item.sku} className="hover:bg-muted/50">
                      <TableCell className="font-mono text-sm text-primary">{item.sku}</TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-muted-foreground">{item.warehouse}</TableCell>
                      <TableCell className="text-center font-semibold">{item.stock}</TableCell>
                      <TableCell className="text-center text-muted-foreground">{item.minStock}</TableCell>
                      <TableCell className="text-center text-muted-foreground">{item.maxStock}</TableCell>
                      <TableCell>
                        <Badge variant={status === "ok" ? "default" : status === "bajo" ? "secondary" : "destructive"}>
                          {status === "ok" ? "OK" : status === "bajo" ? "Bajo" : "Agotado"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{item.lastMovement}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="movements" className="space-y-4">
          {/* Header Actions */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-1 items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar movimiento..." className="pl-9" />
              </div>
              <Select defaultValue="all">
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="entrada">Entradas</SelectItem>
                  <SelectItem value="salida">Salidas</SelectItem>
                  <SelectItem value="transferencia">Transferencias</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="gap-2">
                <ArrowUpRight className="h-4 w-4" />
                Entrada
              </Button>
              <Button variant="outline" className="gap-2">
                <ArrowDownLeft className="h-4 w-4" />
                Salida
              </Button>
            </div>
          </div>

          {/* Movements Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Fecha/Hora</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-center">Cantidad</TableHead>
                  <TableHead>Bodega</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead>Usuario</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((mov) => (
                  <TableRow key={mov.id} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-sm">{mov.id}</TableCell>
                    <TableCell className="text-muted-foreground">{mov.date}</TableCell>
                    <TableCell>
                      <Badge variant={mov.type === "entrada" ? "default" : mov.type === "salida" ? "destructive" : "secondary"}>
                        {mov.type.charAt(0).toUpperCase() + mov.type.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{mov.product}</TableCell>
                    <TableCell className="text-center font-semibold">{mov.quantity}</TableCell>
                    <TableCell className="text-muted-foreground">{mov.warehouse}</TableCell>
                    <TableCell className="font-mono text-sm text-primary">{mov.reference}</TableCell>
                    <TableCell className="text-muted-foreground">{mov.user}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default Inventario;
