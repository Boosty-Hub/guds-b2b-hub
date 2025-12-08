import { useState, useEffect } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Heart, 
  Plus, 
  Minus, 
  Trash2,
  Loader2,
  ShoppingBag,
  Package
} from "lucide-react";
import { Link } from "react-router-dom";
import { supabase, Producto } from "@/lib/supabase";
import { ProductImage } from "@/components/portal/ProductImage";
import { useToast } from "@/hooks/use-toast";

interface FavoritoDB {
  id: string;
  producto_id: string;
  created_at: string;
  producto: Producto;
}

interface CartItem {
  id: string;
  nombre: string;
  precio: number;
  unidad: string;
  imagen: string;
  quantity: number;
}

const PortalFavoritos = () => {
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [favoritos, setFavoritos] = useState<FavoritoDB[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    if (user?.id) {
      fetchFavoritos();
    }
  }, [user]);

  const fetchFavoritos = async () => {
    setLoading(true);
    
    const { data } = await supabase
      .from('favoritos')
      .select(`
        *,
        producto:productos(*)
      `)
      .eq('usuario_id', user?.id)
      .order('created_at', { ascending: false });
    
    if (data) setFavoritos(data);
    setLoading(false);
  };

  const removeFavorito = async (favoritoId: string) => {
    setRemovingId(favoritoId);
    
    const { error } = await supabase
      .from('favoritos')
      .delete()
      .eq('id', favoritoId);
    
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setFavoritos(prev => prev.filter(f => f.id !== favoritoId));
      toast({ title: "Eliminado", description: "Producto eliminado de favoritos" });
    }
    
    setRemovingId(null);
  };

  const addToCart = (product: Producto) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      const precio = product.en_oferta && product.precio_oferta ? product.precio_oferta : product.precio_base;
      return [...prev, { 
        id: product.id, 
        nombre: product.nombre, 
        precio: precio,
        unidad: product.unidad,
        imagen: product.imagen_emoji || '📦',
        quantity: 1 
      }];
    });
    toast({ title: "Agregado", description: `${product.nombre} agregado al carrito` });
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

  const getCartQuantity = (productId: string) => {
    const item = cart.find((i) => i.id === productId);
    return item?.quantity || 0;
  };

  const cartTotal = cart.reduce((sum, item) => sum + item.precio * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <PortalMobileLayout title="Mis Favoritos">
      {/* Header Stats */}
      <div className="px-4 pt-4">
        <div className="bg-gradient-to-r from-red-500 to-pink-500 rounded-xl p-4 text-white">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
              <Heart className="h-6 w-6 fill-white" />
            </div>
            <div>
              <p className="text-2xl font-bold">{favoritos.length}</p>
              <p className="text-sm opacity-90">productos guardados</p>
            </div>
          </div>
        </div>
      </div>

      {/* Favorites List */}
      <div className="px-4 py-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : favoritos.length === 0 ? (
          <div className="text-center py-12">
            <div className="h-20 w-20 rounded-full bg-muted mx-auto flex items-center justify-center mb-4">
              <Heart className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Sin favoritos</h3>
            <p className="text-muted-foreground mb-6">
              Guarda tus productos favoritos para encontrarlos fácilmente
            </p>
            <Link to="/portal/catalogo">
              <Button size="lg" className="gap-2">
                <ShoppingBag className="h-5 w-5" />
                Explorar catálogo
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {favoritos.map((favorito) => {
              const product = favorito.producto;
              if (!product) return null;
              
              const precio = product.en_oferta && product.precio_oferta 
                ? product.precio_oferta 
                : product.precio_base;
              const quantity = getCartQuantity(product.id);
              const inStock = product.stock_actual > 0;

              return (
                <div
                  key={favorito.id}
                  className="bg-card rounded-xl border border-border p-4 relative"
                >
                  {/* Remove Button */}
                  <button
                    onClick={() => removeFavorito(favorito.id)}
                    disabled={removingId === favorito.id}
                    className="absolute top-3 right-3 p-2 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                  >
                    {removingId === favorito.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>

                  <div className="flex gap-4">
                    {/* Product Image */}
                    <div className="relative">
                      <ProductImage 
                        imageUrl={product.imagen_url}
                        emoji={product.imagen_emoji}
                        alt={product.nombre}
                        size="lg"
                      />
                      {!inStock && (
                        <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                          <Badge variant="secondary" className="text-xs">Agotado</Badge>
                        </div>
                      )}
                    </div>

                    {/* Product Info */}
                    <div className="flex-1 min-w-0 pr-8">
                      <h3 className="font-medium text-foreground line-clamp-2 mb-1">
                        {product.nombre}
                      </h3>
                      <p className="text-xs text-muted-foreground mb-2">
                        por {product.unidad}
                      </p>
                      
                      <div className="flex items-center gap-2">
                        <p className="text-primary font-bold text-lg">{formatPrice(precio)}</p>
                        {product.en_oferta && product.precio_oferta && (
                          <p className="text-sm text-muted-foreground line-through">
                            {formatPrice(product.precio_base)}
                          </p>
                        )}
                        {product.en_oferta && product.porcentaje_descuento && (
                          <Badge className="bg-red-500 text-white text-xs">
                            -{product.porcentaje_descuento}%
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Add to Cart */}
                  {inStock && (
                    <div className="mt-3 pt-3 border-t border-border">
                      {quantity === 0 ? (
                        <Button
                          className="w-full gap-2"
                          onClick={() => addToCart(product)}
                        >
                          <Plus className="h-4 w-4" />
                          Agregar al carrito
                        </Button>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">En carrito:</span>
                          <div className="flex items-center gap-2 bg-primary rounded-full">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-9 w-9 p-0 rounded-full text-white hover:bg-white/20"
                              onClick={() => updateQuantity(product.id, -1)}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <span className="text-white font-medium w-8 text-center">{quantity}</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-9 w-9 p-0 rounded-full text-white hover:bg-white/20"
                              onClick={() => updateQuantity(product.id, 1)}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
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
    </PortalMobileLayout>
  );
};

export default PortalFavoritos;
