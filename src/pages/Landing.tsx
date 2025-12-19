import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  ShoppingBag, 
  Truck, 
  Shield, 
  Clock,
  ChevronRight,
  Star,
  Menu,
  X,
  User,
  Phone,
  Package,
  Loader2
} from "lucide-react";
import { Link } from "react-router-dom";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useStoreConfig } from "@/contexts/StoreConfigContext";
import { supabase, Producto } from "@/lib/supabase";
import gudsLogo from "@/assets/guds-logo.png";

interface ProductoLanding {
  id: string;
  nombre: string;
  precio_base: number;
  precio_oferta?: number | null;
  en_oferta?: boolean;
  porcentaje_descuento?: number | null;
  imagen_url?: string | null;
  categoria?: { nombre: string } | null;
}

const benefits = [
  { icon: Truck, title: "Envío Gratis", description: "En compras mayores a $500" },
  { icon: Shield, title: "Pago Seguro", description: "Múltiples métodos de pago" },
  { icon: Clock, title: "Entrega Rápida", description: "24-48 horas hábiles" },
  { icon: Star, title: "Calidad Garantizada", description: "Productos de primera" },
];

const Landing = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [productos, setProductos] = useState<ProductoLanding[]>([]);
  const [loading, setLoading] = useState(true);
  const { formatPrice, currency, setCurrency } = useCurrency();
  const { getActiveBanners, getActiveCategories } = useStoreConfig();

  const banners = getActiveBanners();
  const categories = getActiveCategories();

  useEffect(() => {
    fetchProductos();
  }, []);

  const fetchProductos = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('productos')
      .select('id, nombre, precio_base, precio_oferta, en_oferta, porcentaje_descuento, imagen_url, categoria:categorias(nombre)')
      .eq('activo', true)
      .order('destacado', { ascending: false })
      .limit(8);
    
    if (data) {
      // Transform data to handle categoria as object
      const transformed = data.map(p => ({
        ...p,
        categoria: Array.isArray(p.categoria) ? p.categoria[0] : p.categoria
      }));
      setProductos(transformed);
    }
    setLoading(false);
  };

  const filteredProducts = productos.filter(p => 
    p.nombre.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-primary text-primary-foreground">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2">
              <img src={gudsLogo} alt="GUDS" className="h-10" />
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-6">
              <a href="#productos" className="text-sm font-medium hover:opacity-80">Productos</a>
              <a href="#categorias" className="text-sm font-medium hover:opacity-80">Categorías</a>
              <a href="#nosotros" className="text-sm font-medium hover:opacity-80">Nosotros</a>
              <a href="#contacto" className="text-sm font-medium hover:opacity-80">Contacto</a>
            </nav>

            {/* Actions */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setCurrency(currency === "USD" ? "BS" : "USD")}
                className="hidden sm:block bg-white/20 px-3 py-1.5 rounded-full text-sm font-medium"
              >
                {currency === "USD" ? "$ USD" : "Bs."}
              </button>
              
              <Link to="/login">
                <Button variant="secondary" size="sm" className="hidden sm:flex gap-2">
                  <User className="h-4 w-4" />
                  Iniciar Sesión
                </Button>
              </Link>

              <Link to="/registro">
                <Button size="sm" className="bg-white text-primary hover:bg-white/90">
                  Registrarse
                </Button>
              </Link>

              {/* Mobile Menu Button */}
              <button 
                className="md:hidden p-2"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-primary/95 border-t border-white/10">
            <nav className="container mx-auto px-4 py-4 space-y-3">
              <a href="#productos" className="block py-2 font-medium">Productos</a>
              <a href="#categorias" className="block py-2 font-medium">Categorías</a>
              <a href="#nosotros" className="block py-2 font-medium">Nosotros</a>
              <a href="#contacto" className="block py-2 font-medium">Contacto</a>
              <div className="pt-3 border-t border-white/10">
                <Link to="/login">
                  <Button variant="secondary" className="w-full mb-2">Iniciar Sesión</Button>
                </Link>
              </div>
            </nav>
          </div>
        )}
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-primary via-primary to-primary/80 text-white py-16 md:py-24">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-6">
              Tu Distribuidor Mayorista de Confianza
            </h1>
            <p className="text-lg md:text-xl opacity-90 mb-8">
              Los mejores productos al por mayor para tu negocio. Precios competitivos, entregas rápidas y atención personalizada.
            </p>
            
            {/* Search Bar */}
            <div className="relative max-w-xl mx-auto">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Buscar productos..."
                className="pl-12 h-14 text-lg bg-white text-foreground rounded-full"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap justify-center gap-4 mt-8">
              <Link to="/registro">
                <Button size="lg" className="bg-white text-primary hover:bg-white/90 gap-2">
                  <ShoppingBag className="h-5 w-5" />
                  Quiero ser Cliente
                </Button>
              </Link>
              <a href="#productos">
                <Button size="lg" className="bg-white/20 text-white border-2 border-white hover:bg-white hover:text-primary">
                  Ver Catálogo
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-12 bg-muted/50">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {benefits.map((benefit, index) => (
              <div key={index} className="text-center">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <benefit.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground">{benefit.title}</h3>
                <p className="text-sm text-muted-foreground">{benefit.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Banners */}
      {banners.length > 0 && (
        <section className="py-8">
          <div className="container mx-auto px-4">
            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
              {banners.map((banner) => (
                <div
                  key={banner.id}
                  className={`bg-gradient-to-r ${banner.bgColor} rounded-2xl p-6 min-w-[280px] md:min-w-[350px] text-white flex-shrink-0`}
                >
                  <p className="text-3xl font-bold">{banner.title}</p>
                  <p className="text-lg opacity-90">{banner.subtitle}</p>
                  <Link to="/registro">
                    <Button size="sm" className="mt-4 bg-white/20 hover:bg-white/30">
                      Ver más
                    </Button>
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Categories */}
      <section id="categorias" className="py-12">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold text-foreground">Categorías</h2>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
            {categories.map((cat) => (
              <Link
                key={cat.id}
                to="/registro"
                className="flex flex-col items-center gap-3 min-w-[100px] group"
              >
                <div className={`h-20 w-20 rounded-full ${cat.color} flex items-center justify-center text-3xl group-hover:scale-110 transition-transform`}>
                  {cat.icono}
                </div>
                <span className="text-sm font-medium text-foreground">{cat.nombre}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Products */}
      <section id="productos" className="py-12 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between mb-8">
            <h2 className="text-2xl font-bold text-foreground">Productos Destacados</h2>
            <Link to="/registro" className="text-primary font-medium flex items-center gap-1">
              Ver todo <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No se encontraron productos</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
              {filteredProducts.map((product) => {
                const precio = product.en_oferta && product.precio_oferta ? product.precio_oferta : product.precio_base;
                
                return (
                  <Link
                    key={product.id}
                    to="/registro"
                    className="bg-card rounded-2xl border border-border overflow-hidden group hover:shadow-lg transition-shadow"
                  >
                    {/* Product Image */}
                    <div className="bg-muted aspect-square flex items-center justify-center relative">
                      {product.imagen_url ? (
                        <img 
                          src={product.imagen_url} 
                          alt={product.nombre} 
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Package className="h-16 w-16 text-muted-foreground" />
                      )}
                      {product.en_oferta && product.porcentaje_descuento && (
                        <Badge className="absolute top-3 left-3 bg-red-500 text-white">
                          -{product.porcentaje_descuento}%
                        </Badge>
                      )}
                    </div>

                    {/* Product Info */}
                    <div className="p-4">
                      <h3 className="font-semibold text-foreground line-clamp-2 mb-1 group-hover:text-primary transition-colors">
                        {product.nombre}
                      </h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        {product.categoria?.nombre || 'Sin categoría'}
                      </p>
                      
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xl font-bold text-primary">{formatPrice(precio)}</p>
                          {product.en_oferta && product.precio_oferta && (
                            <p className="text-sm text-muted-foreground line-through">
                              {formatPrice(product.precio_base)}
                            </p>
                          )}
                        </div>
                        <Button size="sm" className="gap-1">
                          <ShoppingBag className="h-4 w-4" />
                          Pedir
                        </Button>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* CTA */}
          <div className="mt-12 text-center">
            <div className="bg-primary/5 rounded-2xl p-8 max-w-2xl mx-auto">
              <h3 className="text-2xl font-bold text-foreground mb-3">
                ¿Quieres acceder a todos nuestros productos?
              </h3>
              <p className="text-muted-foreground mb-6">
                Regístrate como cliente mayorista y obtén acceso a precios especiales, promociones exclusivas y más.
              </p>
              <Link to="/registro">
                <Button size="lg" className="gap-2">
                  <User className="h-5 w-5" />
                  Registrarme Ahora
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* About */}
      <section id="nosotros" className="py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-foreground mb-6">Sobre GUDS Distribuidora</h2>
            <p className="text-lg text-muted-foreground mb-8">
              Somos una empresa líder en distribución mayorista con más de 10 años de experiencia. 
              Nos especializamos en proveer productos de alta calidad a negocios de todos los tamaños, 
              desde pequeñas bodegas hasta grandes supermercados.
            </p>
            <div className="grid grid-cols-3 gap-8">
              <div>
                <p className="text-4xl font-bold text-primary">500+</p>
                <p className="text-muted-foreground">Clientes Activos</p>
              </div>
              <div>
                <p className="text-4xl font-bold text-primary">1000+</p>
                <p className="text-muted-foreground">Productos</p>
              </div>
              <div>
                <p className="text-4xl font-bold text-primary">10+</p>
                <p className="text-muted-foreground">Años de Experiencia</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contacto" className="py-16 bg-muted/50">
        <div className="container mx-auto px-4">
          <div className="max-w-xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-foreground mb-6">¿Tienes Preguntas?</h2>
            <p className="text-muted-foreground mb-8">
              Nuestro equipo está listo para ayudarte. Contáctanos y te responderemos a la brevedad.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Button size="lg" variant="outline" className="gap-2">
                <Phone className="h-5 w-5" />
                +58 212-555-0000
              </Button>
              <Link to="/registro">
                <Button size="lg" className="gap-2 w-full sm:w-auto">
                  Solicitar Información
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-card border-t border-border py-12">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <img src={gudsLogo} alt="GUDS" className="h-12 mb-4" />
              <p className="text-sm text-muted-foreground">
                Tu distribuidor mayorista de confianza. Calidad y servicio garantizado.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Enlaces</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#productos" className="hover:text-primary">Productos</a></li>
                <li><a href="#categorias" className="hover:text-primary">Categorías</a></li>
                <li><a href="#nosotros" className="hover:text-primary">Nosotros</a></li>
                <li><a href="#contacto" className="hover:text-primary">Contacto</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Legal</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link to="/terminos" className="hover:text-primary">Términos y Condiciones</Link></li>
                <li><Link to="/privacidad" className="hover:text-primary">Política de Privacidad</Link></li>
                <li><Link to="/soporte" className="hover:text-primary">Soporte</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Contacto</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>+58 212-555-0000</li>
                <li>info@guds.com</li>
                <li>Caracas, Venezuela</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-border mt-8 pt-8 text-center text-sm text-muted-foreground">
            © 2024 GUDS Distribuidora. Todos los derechos reservados.
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
