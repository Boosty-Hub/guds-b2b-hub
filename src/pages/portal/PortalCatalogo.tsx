import { useState } from "react";
import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Search, ShoppingCart, Plus, Minus, Trash2, Package } from "lucide-react";

interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  unit: string;
  image: string;
  stock: boolean;
}

interface CartItem extends Product {
  quantity: number;
}

const products: Product[] = [
  { id: "1", name: "Aceite Vegetal 5L", category: "Aceites", price: 89.00, unit: "garrafa", image: "🫒", stock: true },
  { id: "2", name: "Arroz Grano Largo 25kg", category: "Granos", price: 450.00, unit: "costal", image: "🍚", stock: true },
  { id: "3", name: "Azúcar Estándar 50kg", category: "Endulzantes", price: 680.00, unit: "costal", image: "🧂", stock: true },
  { id: "4", name: "Frijol Negro 25kg", category: "Granos", price: 520.00, unit: "costal", image: "🫘", stock: true },
  { id: "5", name: "Harina de Trigo 44kg", category: "Harinas", price: 380.00, unit: "costal", image: "🌾", stock: false },
  { id: "6", name: "Sal de Mesa 25kg", category: "Condimentos", price: 120.00, unit: "costal", image: "🧂", stock: true },
  { id: "7", name: "Mayonesa 3.8kg", category: "Condimentos", price: 145.00, unit: "cubeta", image: "🥫", stock: true },
  { id: "8", name: "Pasta Espagueti 5kg", category: "Pastas", price: 85.00, unit: "paquete", image: "🍝", stock: true },
];

const PortalCatalogo = () => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [category, setCategory] = useState("all");

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) =>
          item.id === id ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeFromCart = (id: string) => {
    setCart((prev) => prev.filter((item) => item.id !== id));
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const filteredProducts = products.filter((product) => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = category === "all" || product.category === category;
    return matchesSearch && matchesCategory;
  });

  const categories = [...new Set(products.map((p) => p.category))];

  return (
    <PortalLayout title="Catálogo de Productos">
      {/* Search and Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div className="flex flex-1 items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar productos..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Cart Button */}
        <Sheet>
          <SheetTrigger asChild>
            <Button className="gap-2 relative">
              <ShoppingCart className="h-5 w-5" />
              Mi Pedido
              {cartCount > 0 && (
                <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-xs text-destructive-foreground">
                  {cartCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>Mi Pedido ({cartCount} productos)</SheetTitle>
            </SheetHeader>
            <div className="mt-6 flex flex-col h-[calc(100vh-200px)]">
              {cart.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                  <Package className="h-16 w-16 mb-4 opacity-50" />
                  <p>Tu carrito está vacío</p>
                  <p className="text-sm">Agrega productos del catálogo</p>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-auto space-y-3">
                    {cart.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 rounded-lg border border-border p-3"
                      >
                        <div className="text-3xl">{item.image}</div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-foreground truncate">{item.name}</p>
                          <p className="text-sm text-muted-foreground">
                            ${item.price.toFixed(2)} / {item.unit}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => updateQuantity(item.id, -1)}
                          >
                            <Minus className="h-4 w-4" />
                          </Button>
                          <span className="w-8 text-center font-medium">{item.quantity}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => updateQuantity(item.id, 1)}
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => removeFromCart(item.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-border pt-4 mt-4 space-y-4">
                    <div className="flex justify-between text-lg font-semibold">
                      <span>Total:</span>
                      <span>${cartTotal.toFixed(2)}</span>
                    </div>
                    <Button className="w-full" size="lg">
                      Confirmar Pedido
                    </Button>
                  </div>
                </>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Products Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredProducts.map((product) => (
          <Card key={product.id} className="border-border overflow-hidden">
            <CardContent className="p-0">
              <div className="bg-muted/50 p-6 flex items-center justify-center text-6xl">
                {product.image}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-foreground leading-tight">{product.name}</h3>
                  {!product.stock && (
                    <Badge variant="secondary" className="shrink-0">Agotado</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mb-3">{product.category}</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg font-bold text-primary">${product.price.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">por {product.unit}</p>
                  </div>
                  <Button
                    size="sm"
                    disabled={!product.stock}
                    onClick={() => addToCart(product)}
                    className="gap-1"
                  >
                    <Plus className="h-4 w-4" />
                    Agregar
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PortalLayout>
  );
};

export default PortalCatalogo;
