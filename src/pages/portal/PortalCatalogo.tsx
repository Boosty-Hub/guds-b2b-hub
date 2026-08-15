import { useState, useEffect, useRef } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useStoreConfig } from "@/contexts/StoreConfigContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  Plus, 
  Minus, 
  X, 
  SlidersHorizontal,
  Heart,
  ChevronLeft,
  Loader2,
  Package
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase, Producto, TipoEmpaque } from "@/lib/supabase";
import { ProductImage } from "@/components/portal/ProductImage";
import { notifyCartChanged } from "@/components/portal/PortalCartWidget";
import { useToast } from "@/hooks/use-toast";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";

interface ProductoConEmpaques extends Producto {
  producto_empaques?: {
    id: string;
    tipo_empaque_id: string;
    tipo_empaque: TipoEmpaque;
  }[];
}

interface CartItemDB {
  id: string;
  producto_id: string;
  tipo_empaque_id: string | null;
  cantidad: number;
  precio_unitario: number | null;
}

const PortalCatalogo = () => {
  const [searchParams] = useSearchParams();
  const categoryFromUrl = searchParams.get('cat');
  const shouldFocusSearch = searchParams.get('focus') === 'search';
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  const [cart, setCart] = useState<CartItemDB[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(categoryFromUrl || "Todos");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [productos, setProductos] = useState<ProductoConEmpaques[]>([]);
  const [loading, setLoading] = useState(true);
  // Precios negociados de la lista del cliente: { producto_id: precio }
  const [precioLista, setPrecioLista] = useState<Record<string, number>>({});

  // Empaque selection dialog
  const [isEmpaqueDialogOpen, setIsEmpaqueDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductoConEmpaques | null>(null);
  // Precio real por empaque (mismo que cobra el checkout) para el diálogo: { tipo_empaque_id: precio }
  const [empaquePrecios, setEmpaquePrecios] = useState<Record<string, number>>({});
  const { formatPrice } = useCurrency();
  const { getActiveCategories } = useStoreConfig();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const storeCategories = getActiveCategories();
  // Dedupe TODO el arreglo (incluye el "Todos" fijo): tras el import puede existir una
  // categoría llamada "Todos" u otros nombres repetidos → evita keys duplicadas.
  const categories = Array.from(new Set(["Todos", ...storeCategories.map(c => c.nombre)]));

  useEffect(() => {
    // Update category when URL param changes
    if (categoryFromUrl && categories.includes(categoryFromUrl)) {
      setSelectedCategory(categoryFromUrl);
    }
  }, [categoryFromUrl]);

  useEffect(() => {
    // Focus search input if coming from dashboard search bar
    if (shouldFocusSearch && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [shouldFocusSearch]);

  useEffect(() => {
    fetchProductos();
    if (user?.id) {
      fetchCart();
      fetchFavorites();
      fetchPrecioLista();
    }
  }, [user]);

  // Carga los precios de la lista asignada al cliente (P7)
  const fetchPrecioLista = async () => {
    if (!user?.cliente_id) return;
    const { data: cli } = await supabase
      .from('clientes')
      .select('lista_precios_id')
      .eq('id', user.cliente_id)
      .maybeSingle();
    if (!cli?.lista_precios_id) return;
    const { data } = await supabase
      .from('precios_lista')
      .select('producto_id, precio')
      .eq('lista_precios_id', cli.lista_precios_id);
    if (data) {
      setPrecioLista(Object.fromEntries(data.map((r: { producto_id: string; precio: number }) => [r.producto_id, Number(r.precio)])));
    }
  };

  const fetchProductos = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('productos')
      .select('*, categoria:categorias(*), producto_empaques(*, tipo_empaque:tipos_empaque(*))')
      .eq('activo', true)
      .order('nombre');
    
    if (data) setProductos(data);
    setLoading(false);
  };

  useRealtimeRefetch('productos', fetchProductos);

  const fetchCart = async () => {
    const { data } = await supabase
      .from('carrito')
      .select('id, producto_id, tipo_empaque_id, cantidad, precio_unitario')
      .eq('usuario_id', user?.id);
    
    if (data) setCart(data);
  };

  const fetchFavorites = async () => {
    const { data } = await supabase
      .from('favoritos')
      .select('producto_id')
      .eq('usuario_id', user?.id);
    
    if (data) setFavorites(data.map(f => f.producto_id));
  };

  const handleAddToCart = async (product: ProductoConEmpaques) => {
    if (!user?.id) return;

    const empaques = product.producto_empaques || [];

    if (empaques.length > 1) {
      // Show empaque selection dialog con el precio REAL por empaque (el mismo que cobra el checkout)
      setSelectedProduct(product);
      setEmpaquePrecios({});
      setIsEmpaqueDialogOpen(true);
      const entries = await Promise.all(empaques.map(async (pe) => {
        const { data } = await supabase.rpc('precio_efectivo', {
          p_producto_id: product.id,
          p_tipo_empaque_id: pe.tipo_empaque_id,
          p_cliente_id: user.cliente_id || null,
        });
        const fallback = product.en_oferta && product.precio_oferta ? Number(product.precio_oferta) : Number(product.precio_base);
        return [pe.tipo_empaque_id, data != null ? Number(data) : fallback] as const;
      }));
      setEmpaquePrecios(Object.fromEntries(entries));
    } else if (empaques.length === 1) {
      // Only one empaque, add directly
      addToCartWithEmpaque(product, empaques[0].tipo_empaque);
    } else {
      // No empaques, add with default price
      addToCartWithEmpaque(product, null);
    }
  };

  const addToCartWithEmpaque = async (product: ProductoConEmpaques, empaque: TipoEmpaque | null) => {
    if (!user?.id) return;

    // Precio efectivo autoritativo (lista de cliente / empaque / oferta / base).
    // Es la misma función que usa el checkout, así el carrito nunca miente.
    let precioUnitario: number;
    const { data: precioRpc } = await supabase.rpc('precio_efectivo', {
      p_producto_id: product.id,
      p_tipo_empaque_id: empaque?.id || null,
      p_cliente_id: user.cliente_id || null,
    });
    if (precioRpc != null) {
      precioUnitario = Number(precioRpc);
    } else {
      // Fallback defensivo si el RPC no responde: precio del empaque (P4), sin ×unidades.
      precioUnitario = product.en_oferta && product.precio_oferta ? product.precio_oferta : product.precio_base;
    }

    // Check if same product with same empaque exists in cart
    const existing = cart.find((item) => 
      item.producto_id === product.id && item.tipo_empaque_id === (empaque?.id || null)
    );
    
    if (existing) {
      // Update quantity
      const newCantidad = existing.cantidad + 1;
      setCart(prev => prev.map(item => 
        item.id === existing.id ? { ...item, cantidad: newCantidad } : item
      ));
      
      await supabase
        .from('carrito')
        .update({ cantidad: newCantidad })
        .eq('id', existing.id);
    } else {
      // Insert new item
      const { data } = await supabase
        .from('carrito')
        .insert({
          usuario_id: user.id,
          producto_id: product.id,
          tipo_empaque_id: empaque?.id || null,
          cantidad: 1,
          precio_unitario: precioUnitario
        })
        .select()
        .single();
      
      if (data) {
        setCart(prev => [...prev, { 
          id: data.id, 
          producto_id: product.id, 
          tipo_empaque_id: empaque?.id || null,
          cantidad: 1,
          precio_unitario: precioUnitario
        }]);
      }
    }
    
    setIsEmpaqueDialogOpen(false);
    setSelectedProduct(null);
    
    const empaqueNombre = empaque ? ` (${empaque.nombre})` : '';
    toast({ title: "Agregado", description: `${product.nombre}${empaqueNombre} agregado al carrito` });
    notifyCartChanged();
  };

  const updateQuantity = async (productId: string, delta: number) => {
    const item = cart.find(i => i.producto_id === productId);
    if (!item) return;
    
    const newCantidad = Math.max(0, item.cantidad + delta);
    
    if (newCantidad === 0) {
      // Remove from cart
      setCart(prev => prev.filter(i => i.producto_id !== productId));
      await supabase.from('carrito').delete().eq('id', item.id);
    } else {
      // Update quantity
      setCart(prev => prev.map(i =>
        i.producto_id === productId ? { ...i, cantidad: newCantidad } : i
      ));
      await supabase.from('carrito').update({ cantidad: newCantidad }).eq('id', item.id);
    }
    notifyCartChanged();
  };

  const getCartQuantity = (productId: string) =>
    cart.filter((i) => i.producto_id === productId).reduce((s, i) => s + i.cantidad, 0);

  const toggleFavorite = async (productId: string) => {
    if (!user?.id) return;
    
    if (favorites.includes(productId)) {
      // Remove from favorites
      setFavorites(prev => prev.filter(id => id !== productId));
      await supabase.from('favoritos').delete()
        .eq('usuario_id', user.id)
        .eq('producto_id', productId);
    } else {
      // Add to favorites
      setFavorites(prev => [...prev, productId]);
      await supabase.from('favoritos').insert({
        usuario_id: user.id,
        producto_id: productId
      });
    }
  };

  const getProductPrice = (product: ProductoConEmpaques) => {
    // Precedencia (display): lista del cliente > oferta > precio base
    if (precioLista[product.id] != null) return precioLista[product.id];
    return product.en_oferta && product.precio_oferta ? product.precio_oferta : product.precio_base;
  };

  const cartTotal = cart.reduce((sum, item) => {
    // Use stored precio_unitario if available
    if (item.precio_unitario) {
      return sum + item.precio_unitario * item.cantidad;
    }
    // Fallback to product base price
    const product = productos.find(p => p.id === item.producto_id);
    return sum + (product ? getProductPrice(product) * item.cantidad : 0);
  }, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.cantidad, 0);

  const filteredProducts = productos.filter((product) => {
    const matchesSearch = product.nombre.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "Todos" || product.categoria?.nombre === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <PortalMobileLayout showHeader={false} cartCount={cartCount}>
      {/* Custom Header with Search */}
      <div className="bg-primary text-primary-foreground px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => navigate(-1)} className="p-1">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Buscar productos..."
              className="pl-9 bg-white text-foreground rounded-full h-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus={shouldFocusSearch}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <button onClick={() => setIsFilterOpen(true)} className="p-2 bg-white/20 rounded-full">
            <SlidersHorizontal className="h-5 w-5" />
          </button>
        </div>

        {/* Category Pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-4 px-4">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                selectedCategory === cat
                  ? "bg-white text-primary"
                  : "bg-white/20 text-white"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Results Count */}
      <div className="px-4 py-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {filteredProducts.length} productos encontrados
        </p>
      </div>

      {/* Products Grid */}
      <div className="px-4 pb-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No se encontraron productos</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredProducts.map((product) => {
              const quantity = getCartQuantity(product.id);
              const isFavorite = favorites.includes(product.id);
              const precio = getProductPrice(product);
              const inStock = product.stock_actual > 0;

              return (
                <div
                  key={product.id}
                  className="bg-card rounded-xl border border-border overflow-hidden relative"
                >
                  {/* Favorite Button */}
                  <button
                    onClick={() => toggleFavorite(product.id)}
                    className="absolute top-2 right-2 z-10 p-1.5 bg-white/80 rounded-full"
                  >
                    <Heart
                      className={`h-4 w-4 ${isFavorite ? "fill-red-500 text-red-500" : "text-gray-400"}`}
                    />
                  </button>

                  {/* Discount Badge */}
                  {product.en_oferta && product.porcentaje_descuento && (
                    <Badge className="absolute top-2 left-2 z-10 bg-red-500 text-white text-xs">
                      -{product.porcentaje_descuento}%
                    </Badge>
                  )}

                  {/* Out of Stock Overlay */}
                  {!inStock && (
                    <div className="absolute inset-0 bg-black/50 z-10 flex items-center justify-center">
                      <Badge variant="secondary" className="text-sm">Agotado</Badge>
                    </div>
                  )}

                  {/* Product Image */}
                  <div className="aspect-square bg-muted flex items-center justify-center">
                    <ProductImage 
                      imageUrl={product.imagen_url}
                      emoji={product.imagen_emoji}
                      alt={product.nombre}
                      size="xl"
                      className="h-full w-full rounded-none"
                    />
                  </div>

                  {/* Product Info */}
                  <div className="p-3">
                    <p className="text-sm font-medium text-foreground line-clamp-2 h-10 mb-1">
                      {product.nombre}
                    </p>
                    <p className="text-xs text-muted-foreground mb-2">por {product.unidad}</p>
                    
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-primary font-bold text-lg">{formatPrice(precio)}</p>
                        {product.en_oferta && product.precio_oferta && (
                          <p className="text-xs text-muted-foreground line-through">
                            {formatPrice(product.precio_base)}
                          </p>
                        )}
                      </div>

                      {/* Add to Cart */}
                      {inStock && (
                        <div>
                          {quantity === 0 ? (
                            <Button
                              size="sm"
                              className="h-8 w-8 p-0 rounded-full"
                              onClick={() => handleAddToCart(product)}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          ) : (
                            <div className="flex items-center gap-1 bg-primary rounded-full">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 rounded-full text-white hover:bg-white/20"
                                onClick={() => updateQuantity(product.id, -1)}
                              >
                                <Minus className="h-4 w-4" />
                              </Button>
                              <span className="text-white font-medium w-6 text-center">{quantity}</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 rounded-full text-white hover:bg-white/20"
                                onClick={() => updateQuantity(product.id, 1)}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Cart Button */}
      {cartCount > 0 && (
        <Link to="/portal/carrito">
          <div className="fixed bottom-24 left-4 right-4 max-w-md mx-auto">
            <div className="bg-primary text-white rounded-xl p-4 flex items-center justify-between shadow-lg">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 rounded-full h-10 w-10 flex items-center justify-center font-bold">
                  {cartCount}
                </div>
                <span className="font-medium">Ver carrito</span>
              </div>
              <span className="font-bold text-lg">{formatPrice(cartTotal)}</span>
            </div>
          </div>
        </Link>
      )}

      {/* Filter Sheet */}
      <Sheet open={isFilterOpen} onOpenChange={setIsFilterOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Filtros</SheetTitle>
          </SheetHeader>
          <div className="py-4 space-y-4">
            <div>
              <p className="font-medium mb-3">Categoría</p>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      setSelectedCategory(cat);
                      setIsFilterOpen(false);
                    }}
                    className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                      selectedCategory === cat
                        ? "bg-primary text-white border-primary"
                        : "bg-background border-border"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="font-medium mb-3">Ordenar por</p>
              <div className="flex flex-wrap gap-2">
                {["Relevancia", "Menor precio", "Mayor precio", "Ofertas"].map((opt) => (
                  <button
                    key={opt}
                    className="px-4 py-2 rounded-full text-sm font-medium border border-border bg-background"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Empaque Selection Dialog */}
      <Dialog open={isEmpaqueDialogOpen} onOpenChange={setIsEmpaqueDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Selecciona el empaque</DialogTitle>
          </DialogHeader>
          {selectedProduct && (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-3 pb-3 border-b">
                <ProductImage
                  imageUrl={selectedProduct.imagen_url}
                  images={selectedProduct.imagenes}
                  emoji={selectedProduct.imagen_emoji}
                  alt={selectedProduct.nombre}
                  size="xl"
                />
                <div>
                  <p className="font-medium">{selectedProduct.nombre}</p>
                  <p className="text-sm text-muted-foreground">
                    Precio base: {formatPrice(selectedProduct.precio_base)}
                  </p>
                </div>
              </div>
              
              <div className="space-y-2">
                {selectedProduct.producto_empaques?.map((pe) => {
                  // Precio real del empaque (el que cobra el checkout); fallback mientras carga
                  const precioTotal = empaquePrecios[pe.tipo_empaque_id] ?? (selectedProduct.precio_base * pe.tipo_empaque.unidades);
                  return (
                    <button
                      key={pe.id}
                      onClick={() => addToCartWithEmpaque(selectedProduct, pe.tipo_empaque)}
                      className="w-full flex items-center justify-between p-3 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Package className="h-5 w-5 text-muted-foreground" />
                        <div className="text-left">
                          <p className="font-medium">{pe.tipo_empaque.nombre}</p>
                          <p className="text-xs text-muted-foreground">
                            {pe.tipo_empaque.unidades} unidades
                          </p>
                        </div>
                      </div>
                      <p className="font-bold text-primary">{formatPrice(precioTotal)}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PortalMobileLayout>
  );
};

export default PortalCatalogo;
