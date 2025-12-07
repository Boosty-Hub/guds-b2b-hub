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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, Tags, Edit, Users, Percent } from "lucide-react";

const priceLists = [
  { id: "PL-001", name: "Estándar", description: "Lista de precios base", clients: 45, products: 482, discount: "0%", status: "activo" },
  { id: "PL-002", name: "Mayorista", description: "Descuentos para compras al por mayor", clients: 28, products: 482, discount: "15%", status: "activo" },
  { id: "PL-003", name: "Premium", description: "Clientes VIP con mejores precios", clients: 12, products: 482, discount: "20%", status: "activo" },
  { id: "PL-004", name: "Promocional", description: "Precios especiales temporales", clients: 0, products: 156, discount: "25%", status: "inactivo" },
];

const priceListProducts = [
  { sku: "ARR-001", name: "Arroz Premium 50kg", basePrice: 85.00, standardPrice: 85.00, mayoristaPrice: 72.25, premiumPrice: 68.00 },
  { sku: "ACE-001", name: "Aceite Vegetal 20L", basePrice: 45.00, standardPrice: 45.00, mayoristaPrice: 38.25, premiumPrice: 36.00 },
  { sku: "AZU-001", name: "Azúcar Blanca 50kg", basePrice: 72.00, standardPrice: 72.00, mayoristaPrice: 61.20, premiumPrice: 57.60 },
  { sku: "HAR-001", name: "Harina de Trigo 50kg", basePrice: 68.00, standardPrice: 68.00, mayoristaPrice: 57.80, premiumPrice: 54.40 },
  { sku: "SAL-001", name: "Sal Yodada 25kg", basePrice: 18.00, standardPrice: 18.00, mayoristaPrice: 15.30, premiumPrice: 14.40 },
  { sku: "FRI-001", name: "Frijoles Negros 50kg", basePrice: 95.00, standardPrice: 95.00, mayoristaPrice: 80.75, premiumPrice: 76.00 },
];

const Precios = () => {
  return (
    <MainLayout title="Listas de Precios">
      {/* Stats */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Tags className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">4</p>
              <p className="text-sm text-muted-foreground">Listas de Precios</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-success/10 p-2">
              <Tags className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold">3</p>
              <p className="text-sm text-muted-foreground">Activas</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">85</p>
              <p className="text-sm text-muted-foreground">Clientes Asignados</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Percent className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">15%</p>
              <p className="text-sm text-muted-foreground">Descuento Promedio</p>
            </div>
          </div>
        </div>
      </div>

      <Tabs defaultValue="lists" className="space-y-6">
        <TabsList>
          <TabsTrigger value="lists">Listas de Precios</TabsTrigger>
          <TabsTrigger value="comparison">Comparación de Precios</TabsTrigger>
        </TabsList>

        <TabsContent value="lists" className="space-y-4">
          {/* Header Actions */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar lista de precios..." className="pl-9" />
            </div>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Nueva Lista
            </Button>
          </div>

          {/* Price Lists Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {priceLists.map((list) => (
              <div key={list.id} className="rounded-xl border border-border bg-card p-6 shadow-sm transition-all duration-200 hover:shadow-md animate-fade-in">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{list.name}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{list.description}</p>
                  </div>
                  <Badge variant={list.status === "activo" ? "default" : "secondary"}>
                    {list.status === "activo" ? "Activo" : "Inactivo"}
                  </Badge>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-2xl font-bold text-foreground">{list.clients}</p>
                    <p className="text-xs text-muted-foreground">Clientes</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-foreground">{list.products}</p>
                    <p className="text-xs text-muted-foreground">Productos</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-primary">{list.discount}</p>
                    <p className="text-xs text-muted-foreground">Descuento</p>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1 gap-1">
                    <Edit className="h-4 w-4" />
                    Editar
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 gap-1">
                    <Users className="h-4 w-4" />
                    Clientes
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="comparison" className="space-y-4">
          {/* Header Actions */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar producto..." className="pl-9" />
            </div>
          </div>

          {/* Price Comparison Table */}
          <div className="rounded-xl border border-border bg-card shadow-sm animate-fade-in">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Precio Base</TableHead>
                  <TableHead className="text-right">Estándar</TableHead>
                  <TableHead className="text-right">Mayorista</TableHead>
                  <TableHead className="text-right">Premium</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {priceListProducts.map((product) => (
                  <TableRow key={product.sku} className="hover:bg-muted/50">
                    <TableCell className="font-mono text-sm text-primary">{product.sku}</TableCell>
                    <TableCell className="font-medium">{product.name}</TableCell>
                    <TableCell className="text-right text-muted-foreground">${product.basePrice.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium">${product.standardPrice.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium text-success">${product.mayoristaPrice.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium text-primary">${product.premiumPrice.toFixed(2)}</TableCell>
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

export default Precios;
