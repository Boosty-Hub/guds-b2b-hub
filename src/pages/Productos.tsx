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
import { Plus, Search, Package, Edit, Copy } from "lucide-react";

const products = [
  { id: "PRD-001", sku: "ARR-001", name: "Arroz Premium 50kg", category: "Granos", unit: "Saco", basePrice: "$85.00", stock: 250, status: "disponible" },
  { id: "PRD-002", sku: "ACE-001", name: "Aceite Vegetal 20L", category: "Aceites", unit: "Bidón", basePrice: "$45.00", stock: 180, status: "disponible" },
  { id: "PRD-003", sku: "AZU-001", name: "Azúcar Blanca 50kg", category: "Endulzantes", unit: "Saco", basePrice: "$72.00", stock: 15, status: "bajo_stock" },
  { id: "PRD-004", sku: "HAR-001", name: "Harina de Trigo 50kg", category: "Harinas", unit: "Saco", basePrice: "$68.00", stock: 320, status: "disponible" },
  { id: "PRD-005", sku: "SAL-001", name: "Sal Yodada 25kg", category: "Condimentos", unit: "Saco", basePrice: "$18.00", stock: 0, status: "agotado" },
  { id: "PRD-006", sku: "FRI-001", name: "Frijoles Negros 50kg", category: "Granos", unit: "Saco", basePrice: "$95.00", stock: 145, status: "disponible" },
  { id: "PRD-007", sku: "LEN-001", name: "Lentejas 25kg", category: "Granos", unit: "Saco", basePrice: "$55.00", stock: 8, status: "bajo_stock" },
  { id: "PRD-008", sku: "PAS-001", name: "Pasta Spaghetti 10kg", category: "Pastas", unit: "Caja", basePrice: "$32.00", stock: 420, status: "disponible" },
];

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  disponible: { label: "Disponible", variant: "default" },
  bajo_stock: { label: "Bajo Stock", variant: "secondary" },
  agotado: { label: "Agotado", variant: "destructive" },
};

const Productos = () => {
  return (
    <MainLayout title="Productos">
      {/* Stats */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Package className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">482</p>
              <p className="text-sm text-muted-foreground">Total Productos</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success/10 p-2">
              <Package className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold">412</p>
              <p className="text-sm text-muted-foreground">Disponibles</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-warning/10 p-2">
              <Package className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold">55</p>
              <p className="text-sm text-muted-foreground">Bajo Stock</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-destructive/10 p-2">
              <Package className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">15</p>
              <p className="text-sm text-muted-foreground">Agotados</p>
            </div>
          </div>
        </div>
      </div>

      {/* Header Actions */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar producto..." className="pl-9" />
          </div>
          <Select defaultValue="all">
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              <SelectItem value="granos">Granos</SelectItem>
              <SelectItem value="aceites">Aceites</SelectItem>
              <SelectItem value="harinas">Harinas</SelectItem>
              <SelectItem value="pastas">Pastas</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo Producto
        </Button>
      </div>

      {/* Products Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Unidad</TableHead>
              <TableHead className="text-right">Precio Base</TableHead>
              <TableHead className="text-center">Stock</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.id} className="hover:bg-muted/50">
                <TableCell className="font-mono text-sm text-primary">{product.sku}</TableCell>
                <TableCell className="font-medium">{product.name}</TableCell>
                <TableCell className="text-muted-foreground">{product.category}</TableCell>
                <TableCell>{product.unit}</TableCell>
                <TableCell className="text-right font-semibold">{product.basePrice}</TableCell>
                <TableCell className="text-center">{product.stock}</TableCell>
                <TableCell>
                  <Badge variant={statusConfig[product.status].variant}>
                    {statusConfig[product.status].label}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Copy className="h-4 w-4" />
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

export default Productos;
