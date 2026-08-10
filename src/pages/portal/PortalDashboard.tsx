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
import { BannerVisual } from "@/components/BannerVisual";
import { useDeviceType } from "@/hooks/use-mobile";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";

interface Orden {
  id: string;
  numero: string;
  estado: string;
  total: number;
  created_at: string;
  items_count?: number;
}

const PortalDashboard = () => {
  const { formatPrice } = useCurrency();
  const { getActiveBanners, getActiveCategories } = useStoreConfig();
  const { user } = useAuth();
  const deviceType = useDeviceType();
  const isTablet = deviceType === "tablet";
  
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

  useRealtimeRefetch('productos', fetchData, !!user?.cliente_id);

  const creditoDisponible = cliente ? cliente.limite_credito - cliente.credito_utilizado : 0;
  const porcentajeCredito = cliente && cliente.limite_credito > 0 
    ? (cliente.credito_utilizado / cliente.limite_credito) * 100 
    : 0;

  // Clases responsivas para tablet
  const paddingX = isTablet ? "px-6" : "px-4";
  const gapSize = isTablet ? "gap-4" : "gap-3";

  return (
    <PortalMobileLayout>
      {/* Search Bar */}
      <Link to="/portal/catalogo?focus=search">
        <div className={`${paddingX} mt-4 mb-3`}>
          <div className={`bg-muted rounded-full flex items-center ${gapSize} ${isTablet ? 'px-5 py-4' : 'px-4 py-3'}`}>
            <span className="text-muted-foreground">🔍</span>
            <span className={`text-muted-foreground ${isTablet ? 'text-base' : 'text-sm'}`}>Buscar productos...</span>
          </div>
        </div>
      </Link>

      {/* Promotions Carousel */}
      <div className={`${paddingX} mb-4`}>
        <div className={`flex ${gapSize} overflow-x-auto pb-2 scrollbar-hide`}>
          {banners.map((banner) => (
            <Link key={banner.id} to={banner.link} className="flex-shrink-0">
              <BannerVisual
                banner={banner}
                className={`rounded-xl ${isTablet ? 'p-5 min-w-[280px]' : 'p-4 min-w-[200px]'}`}
                titleClassName={`font-bold ${isTablet ? 'text-3xl' : 'text-2xl'}`}
                subtitleClassName={`opacity-90 ${isTablet ? 'text-base' : 'text-sm'}`}
              />
            </Link>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className={`${paddingX} mb-4`}>
        <div className={`grid ${isTablet ? 'grid-cols-6' : 'grid-cols-4'} gap-2`}>
          <Link to="/portal/pedidos" className={`flex flex-col items-center gap-1 bg-card rounded-xl border border-border ${isTablet ? 'p-4' : 'p-3'}`}>
            <div className={`rounded-full bg-blue-500/10 flex items-center justify-center ${isTablet ? 'h-12 w-12' : 'h-10 w-10'}`}>
              <Package className={`text-blue-500 ${isTablet ? 'h-6 w-6' : 'h-5 w-5'}`} />
            </div>
            <span className={`text-center ${isTablet ? 'text-sm' : 'text-xs'}`}>Mis Pedidos</span>
          </Link>
          <Link to="/portal/pagos" className={`flex flex-col items-center gap-1 bg-card rounded-xl border border-border ${isTablet ? 'p-4' : 'p-3'}`}>
            <div className={`rounded-full bg-green-500/10 flex items-center justify-center ${isTablet ? 'h-12 w-12' : 'h-10 w-10'}`}>
              <CreditCard className={`text-green-500 ${isTablet ? 'h-6 w-6' : 'h-5 w-5'}`} />
            </div>
            <span className={`text-center ${isTablet ? 'text-sm' : 'text-xs'}`}>Pagos</span>
          </Link>
          <Link to="/portal/catalogo" className={`flex flex-col items-center gap-1 bg-card rounded-xl border border-border ${isTablet ? 'p-4' : 'p-3'}`}>
            <div className={`rounded-full bg-orange-500/10 flex items-center justify-center ${isTablet ? 'h-12 w-12' : 'h-10 w-10'}`}>
              <Percent className={`text-orange-500 ${isTablet ? 'h-6 w-6' : 'h-5 w-5'}`} />
            </div>
            <span className={`text-center ${isTablet ? 'text-sm' : 'text-xs'}`}>Ofertas</span>
          </Link>
          <Link to="/portal/favoritos" className={`flex flex-col items-center gap-1 bg-card rounded-xl border border-border ${isTablet ? 'p-4' : 'p-3'}`}>
            <div className={`rounded-full bg-purple-500/10 flex items-center justify-center ${isTablet ? 'h-12 w-12' : 'h-10 w-10'}`}>
              <Star className={`text-purple-500 ${isTablet ? 'h-6 w-6' : 'h-5 w-5'}`} />
            </div>
            <span className={`text-center ${isTablet ? 'text-sm' : 'text-xs'}`}>Favoritos</span>
          </Link>
          {isTablet && (
            <>
              <Link to="/portal/cuenta/cupones" className={`flex flex-col items-center gap-1 bg-card rounded-xl border border-border p-4`}>
                <div className="h-12 w-12 rounded-full bg-pink-500/10 flex items-center justify-center">
                  <Zap className="h-6 w-6 text-pink-500" />
                </div>
                <span className="text-sm text-center">Cupones</span>
              </Link>
              <Link to="/portal/cuenta" className={`flex flex-col items-center gap-1 bg-card rounded-xl border border-border p-4`}>
                <div className="h-12 w-12 rounded-full bg-cyan-500/10 flex items-center justify-center">
                  <Clock className="h-6 w-6 text-cyan-500" />
                </div>
                <span className="text-sm text-center">Historial</span>
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Active Order Banner */}
      {ordenes.filter(o => o.estado === "enviado" || o.estado === "en_camino").slice(0, 1).map((order) => (
        <Link key={order.id} to="/portal/pedidos">
          <div className={`${paddingX} mb-4`}>
            <div className={`bg-blue-500 rounded-xl text-white ${isTablet ? 'p-5' : 'p-4'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`rounded-full bg-white/20 flex items-center justify-center ${isTablet ? 'h-12 w-12' : 'h-10 w-10'}`}>
                    <Truck className={isTablet ? 'h-6 w-6' : 'h-5 w-5'} />
                  </div>
                  <div>
                    <p className={`font-semibold ${isTablet ? 'text-lg' : ''}`}>Pedido en camino</p>
                    <p className={`opacity-90 ${isTablet ? 'text-base' : 'text-sm'}`}>{order.numero}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`font-medium ${isTablet ? 'text-base' : 'text-sm'}`}>{formatPrice(order.total)}</p>
                  <ChevronRight className={isTablet ? 'h-6 w-6 ml-auto' : 'h-5 w-5 ml-auto'} />
                </div>
              </div>
            </div>
          </div>
        </Link>
      ))}

      {/* Categories */}
      <div className={`${paddingX} mb-4`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`font-semibold text-foreground ${isTablet ? 'text-lg' : ''}`}>Categorías</h2>
          <Link to="/portal/catalogo" className={`text-primary font-medium ${isTablet ? 'text-base' : 'text-sm'}`}>Ver todo</Link>
        </div>
        <div className={`flex ${gapSize} overflow-x-auto pb-2 scrollbar-hide`}>
          {categories.map((cat) => (
            <Link
              key={cat.id}
              to={`/portal/catalogo?cat=${cat.nombre}`}
              className={`flex flex-col items-center gap-2 ${isTablet ? 'min-w-[90px]' : 'min-w-[70px]'}`}
            >
              <div className={`rounded-full ${cat.color} flex items-center justify-center ${isTablet ? 'h-16 w-16 text-3xl' : 'h-14 w-14 text-2xl'}`}>
                {cat.icono}
              </div>
              <span className={`text-center text-foreground ${isTablet ? 'text-sm' : 'text-xs'}`}>{cat.nombre}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Featured Products */}
      <div className={`${paddingX} mb-4`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`font-semibold text-foreground flex items-center gap-2 ${isTablet ? 'text-lg' : ''}`}>
            <Zap className={`text-yellow-500 ${isTablet ? 'h-5 w-5' : 'h-4 w-4'}`} />
            Productos Destacados
          </h2>
          <Link to="/portal/catalogo" className={`text-primary font-medium ${isTablet ? 'text-base' : 'text-sm'}`}>Ver todo</Link>
        </div>
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className={`animate-spin text-primary ${isTablet ? 'h-8 w-8' : 'h-6 w-6'}`} />
          </div>
        ) : productos.length === 0 ? (
          <p className="text-center text-muted-foreground py-4">No hay productos destacados</p>
        ) : (
          <div className={`grid ${isTablet ? 'grid-cols-3' : 'grid-cols-2'} ${gapSize}`}>
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
                      <Badge className={`absolute top-2 left-2 bg-red-500 text-white z-10 ${isTablet ? 'text-sm' : 'text-xs'}`}>
                        -{product.porcentaje_descuento}%
                      </Badge>
                    )}
                  </div>
                  <div className={isTablet ? 'p-4' : 'p-3'}>
                    <p className={`font-medium text-foreground line-clamp-2 mb-1 ${isTablet ? 'text-base' : 'text-sm'}`}>{product.nombre}</p>
                    <div className="flex items-center gap-2">
                      <p className={`text-primary font-bold ${isTablet ? 'text-lg' : ''}`}>
                        {formatPrice(product.en_oferta && product.precio_oferta ? product.precio_oferta : product.precio_base)}
                      </p>
                      {product.en_oferta && product.precio_oferta && (
                        <p className={`text-muted-foreground line-through ${isTablet ? 'text-sm' : 'text-xs'}`}>
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
        <div className={`${paddingX} mb-4`}>
          <div className={`bg-card rounded-xl border border-border ${isTablet ? 'p-5' : 'p-4'}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`font-semibold text-foreground ${isTablet ? 'text-lg' : ''}`}>Mi Línea de Crédito</h3>
              <Badge variant="outline" className="text-green-500 border-green-500">Activa</Badge>
            </div>
            <div className="space-y-2">
              <div className={`flex justify-between ${isTablet ? 'text-base' : 'text-sm'}`}>
                <span className="text-muted-foreground">Disponible</span>
                <span className="font-semibold text-green-500">{formatPrice(creditoDisponible)}</span>
              </div>
              <div className={`flex justify-between ${isTablet ? 'text-base' : 'text-sm'}`}>
                <span className="text-muted-foreground">Utilizado</span>
                <span className="font-medium">{formatPrice(cliente.credito_utilizado)}</span>
              </div>
              <div className={`bg-muted rounded-full overflow-hidden ${isTablet ? 'h-3' : 'h-2'}`}>
                <div className="h-full bg-green-500 rounded-full" style={{ width: `${porcentajeCredito}%` }} />
              </div>
              <div className={`flex justify-between text-muted-foreground ${isTablet ? 'text-sm' : 'text-xs'}`}>
                <span>{porcentajeCredito.toFixed(0)}% utilizado</span>
                <span>Límite: {formatPrice(cliente.limite_credito)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className={`${paddingX} mb-6`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className={`font-semibold text-foreground ${isTablet ? 'text-lg' : ''}`}>Actividad Reciente</h2>
          <Link to="/portal/pedidos" className={`text-primary font-medium ${isTablet ? 'text-base' : 'text-sm'}`}>Ver todo</Link>
        </div>
        <div className="space-y-3">
          {ordenes.length === 0 ? (
            <div className={`bg-card rounded-xl border border-border text-center ${isTablet ? 'p-8' : 'p-6'}`}>
              <Package className={`mx-auto text-muted-foreground mb-2 ${isTablet ? 'h-10 w-10' : 'h-8 w-8'}`} />
              <p className="text-muted-foreground">No hay pedidos recientes</p>
              <Link to="/portal/catalogo" className={`text-primary font-medium ${isTablet ? 'text-base' : 'text-sm'}`}>Hacer un pedido</Link>
            </div>
          ) : (
            ordenes.slice(0, isTablet ? 5 : 3).map((order) => (
              <Link key={order.id} to="/portal/pedidos">
                <div className={`bg-card rounded-xl border border-border flex items-center justify-between ${isTablet ? 'p-5' : 'p-4'}`}>
                  <div className="flex items-center gap-3">
                    <div className={`rounded-full flex items-center justify-center ${isTablet ? 'h-12 w-12' : 'h-10 w-10'} ${
                      order.estado === "enviado" || order.estado === "en_camino" ? "bg-blue-500/10" : 
                      order.estado === "completado" ? "bg-green-500/10" : "bg-yellow-500/10"
                    }`}>
                      {order.estado === "enviado" || order.estado === "en_camino" ? (
                        <Truck className={`text-blue-500 ${isTablet ? 'h-6 w-6' : 'h-5 w-5'}`} />
                      ) : order.estado === "completado" ? (
                        <Package className={`text-green-500 ${isTablet ? 'h-6 w-6' : 'h-5 w-5'}`} />
                      ) : (
                        <Clock className={`text-yellow-500 ${isTablet ? 'h-6 w-6' : 'h-5 w-5'}`} />
                      )}
                    </div>
                    <div>
                      <p className={`font-medium text-foreground ${isTablet ? 'text-base' : ''}`}>{order.numero}</p>
                      <p className={`text-muted-foreground ${isTablet ? 'text-sm' : 'text-xs'}`}>{formatPrice(order.total)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={
                      order.estado === "enviado" || order.estado === "en_camino" ? "default" : 
                      order.estado === "completado" ? "secondary" : "outline"
                    }>
                      {order.estado === "enviado" || order.estado === "en_camino" ? "En camino" : 
                       order.estado === "completado" ? "Entregado" : 
                       order.estado === "pendiente" ? "Pendiente" : order.estado}
                    </Badge>
                    <ChevronRight className={`text-muted-foreground ${isTablet ? 'h-5 w-5' : 'h-4 w-4'}`} />
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
