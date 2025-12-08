import { useState, useEffect } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { Badge } from "@/components/ui/badge";
import { 
  Package, 
  Truck, 
  CreditCard, 
  ChevronRight, 
  Percent,
  Clock,
  Star,
  Zap,
  Loader2
} from "lucide-react";
import { Link } from "react-router-dom";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useStoreConfig } from "@/contexts/StoreConfigContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase, Producto, Cliente } from "@/lib/supabase";
import { ProductImage } from "@/components/portal/ProductImage";

interface Orden {
  id: string;
  numero_orden: string;
  estado: string;
  total: number;
  created_at: string;
  items_count?: number;
}

const PortalDashboard = () => {
  const { formatPrice } = useCurrency();
  const { getActiveBanners, getActiveCategories } = useStoreConfig();
  const { user } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  
  const banners = getActiveBanners();
  const categories = getActiveCategories();

  useEffect(() => {
    if (user?.cliente_id) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    setLoading(true);
    
    // Fetch cliente info
    const { data: clienteData } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', user?.cliente_id)
      .single();
    
    if (clienteData) setCliente(clienteData);

    // Fetch productos destacados
    const { data: productosData } = await supabase
      .from('productos')
      .select('*, categoria:categorias(*)')
      .eq('activo', true)
      .eq('destacado', true)
      .limit(4);
    
    if (productosData) setProductos(productosData);

    // Fetch órdenes recientes
    if (user?.cliente_id) {
      const { data: ordenesData } = await supabase
        .from('ordenes')
        .select('*')
        .eq('cliente_id', user.cliente_id)
        .order('created_at', { ascending: false })
        .limit(5);
      
      if (ordenesData) setOrdenes(ordenesData);
    }

    setLoading(false);
  };

  const creditoDisponible = cliente ? cliente.limite_credito - cliente.credito_utilizado : 0;
  const porcentajeCredito = cliente && cliente.limite_credito > 0 
    ? (cliente.credito_utilizado / cliente.limite_credito) * 100 
    : 0;

  return (
    <PortalMobileLayout>
      {/* Search Bar */}
      <Link to="/portal/catalogo?focus=search">
        <div className="mx-4 mt-4 mb-3">
          <div className="bg-muted rounded-full px-4 py-3 flex items-center gap-3">
            <span className="text-muted-foreground">🔍</span>
            <span className="text-muted-foreground text-sm">Buscar productos...</span>
          </div>
        </div>
      </Link>

      {/* Promotions Carousel */}
      <div className="px-4 mb-4">
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {banners.map((banner) => (
            <Link
              key={banner.id}
              to={banner.link}
              className={`bg-gradient-to-r ${banner.bgColor} rounded-xl p-4 min-w-[200px] text-white flex-shrink-0`}
            >
              <p className="text-2xl font-bold">{banner.title}</p>
              <p className="text-sm opacity-90">{banner.subtitle}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="px-4 mb-4">
        <div className="grid grid-cols-4 gap-2">
          <Link to="/portal/pedidos" className="flex flex-col items-center gap-1 p-3 bg-card rounded-xl border border-border">
            <div className="h-10 w-10 rounded-full bg-blue-500/10 flex items-center justify-center">
              <Package className="h-5 w-5 text-blue-500" />
            </div>
            <span className="text-xs text-center">Mis Pedidos</span>
          </Link>
          <Link to="/portal/pagos" className="flex flex-col items-center gap-1 p-3 bg-card rounded-xl border border-border">
            <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-green-500" />
            </div>
            <span className="text-xs text-center">Pagos</span>
          </Link>
          <Link to="/portal/catalogo" className="flex flex-col items-center gap-1 p-3 bg-card rounded-xl border border-border">
            <div className="h-10 w-10 rounded-full bg-orange-500/10 flex items-center justify-center">
              <Percent className="h-5 w-5 text-orange-500" />
            </div>
            <span className="text-xs text-center">Ofertas</span>
          </Link>
          <Link to="/portal/favoritos" className="flex flex-col items-center gap-1 p-3 bg-card rounded-xl border border-border">
            <div className="h-10 w-10 rounded-full bg-purple-500/10 flex items-center justify-center">
              <Star className="h-5 w-5 text-purple-500" />
            </div>
            <span className="text-xs text-center">Favoritos</span>
          </Link>
        </div>
      </div>

      {/* Active Order Banner */}
      {ordenes.filter(o => o.estado === "enviado" || o.estado === "en_camino").slice(0, 1).map((order) => (
        <Link key={order.id} to="/portal/pedidos">
          <div className="mx-4 mb-4 bg-blue-500 rounded-xl p-4 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-white/20 flex items-center justify-center">
                  <Truck className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold">Pedido en camino</p>
                  <p className="text-sm opacity-90">{order.numero_orden}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{formatPrice(order.total)}</p>
                <ChevronRight className="h-5 w-5 ml-auto" />
              </div>
            </div>
          </div>
        </Link>
      ))}

      {/* Categories */}
      <div className="px-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-foreground">Categorías</h2>
          <Link to="/portal/catalogo" className="text-primary text-sm font-medium">Ver todo</Link>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              to={`/portal/catalogo?cat=${cat.nombre}`}
              className="flex flex-col items-center gap-2 min-w-[70px]"
            >
              <div className={`h-14 w-14 rounded-full ${cat.color} flex items-center justify-center text-2xl`}>
                {cat.icono}
              </div>
              <span className="text-xs text-center text-foreground">{cat.nombre}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Featured Products */}
      <div className="px-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Zap className="h-4 w-4 text-yellow-500" />
            Productos Destacados
          </h2>
          <Link to="/portal/catalogo" className="text-primary text-sm font-medium">Ver todo</Link>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : productos.length === 0 ? (
          <p className="text-center text-muted-foreground py-4">No hay productos destacados</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {productos.map((product) => (
              <Link key={product.id} to="/portal/catalogo">
                <div className="bg-card rounded-xl border border-border overflow-hidden">
                  <div className="aspect-square bg-muted flex items-center justify-center relative">
                    <ProductImage 
                      imageUrl={product.imagen_url}
                      emoji={product.imagen_emoji}
                      alt={product.nombre}
                      size="xl"
                      className="h-full w-full rounded-none"
                    />
                    {product.en_oferta && product.porcentaje_descuento && (
                      <Badge className="absolute top-2 left-2 bg-red-500 text-white text-xs z-10">
                        -{product.porcentaje_descuento}%
                      </Badge>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-medium text-foreground line-clamp-2 mb-1">{product.nombre}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-primary font-bold">
                        {formatPrice(product.en_oferta && product.precio_oferta ? product.precio_oferta : product.precio_base)}
                      </p>
                      {product.en_oferta && product.precio_oferta && (
                        <p className="text-xs text-muted-foreground line-through">
                          {formatPrice(product.precio_base)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Credit Status */}
      {cliente && cliente.limite_credito > 0 && (
        <div className="px-4 mb-4">
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-foreground">Mi Línea de Crédito</h3>
              <Badge variant="outline" className="text-green-500 border-green-500">Activa</Badge>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Disponible</span>
                <span className="font-semibold text-green-500">{formatPrice(creditoDisponible)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Utilizado</span>
                <span className="font-medium">{formatPrice(cliente.credito_utilizado)}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full" style={{ width: `${porcentajeCredito}%` }} />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{porcentajeCredito.toFixed(0)}% utilizado</span>
                <span>Límite: {formatPrice(cliente.limite_credito)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="px-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-foreground">Actividad Reciente</h2>
          <Link to="/portal/pedidos" className="text-primary text-sm font-medium">Ver todo</Link>
        </div>
        <div className="space-y-3">
          {ordenes.length === 0 ? (
            <div className="bg-card rounded-xl border border-border p-6 text-center">
              <Package className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No hay pedidos recientes</p>
              <Link to="/portal/catalogo" className="text-primary text-sm font-medium">Hacer un pedido</Link>
            </div>
          ) : (
            ordenes.slice(0, 3).map((order) => (
              <Link key={order.id} to="/portal/pedidos">
                <div className="bg-card rounded-xl border border-border p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                      order.estado === "enviado" || order.estado === "en_camino" ? "bg-blue-500/10" : 
                      order.estado === "entregado" ? "bg-green-500/10" : "bg-yellow-500/10"
                    }`}>
                      {order.estado === "enviado" || order.estado === "en_camino" ? (
                        <Truck className="h-5 w-5 text-blue-500" />
                      ) : order.estado === "entregado" ? (
                        <Package className="h-5 w-5 text-green-500" />
                      ) : (
                        <Clock className="h-5 w-5 text-yellow-500" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{order.numero_orden}</p>
                      <p className="text-xs text-muted-foreground">{formatPrice(order.total)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={
                      order.estado === "enviado" || order.estado === "en_camino" ? "default" : 
                      order.estado === "entregado" ? "secondary" : "outline"
                    }>
                      {order.estado === "enviado" || order.estado === "en_camino" ? "En camino" : 
                       order.estado === "entregado" ? "Entregado" : 
                       order.estado === "pendiente" ? "Pendiente" : order.estado}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </PortalMobileLayout>
  );
};

export default PortalDashboard;
