import { useState, useEffect } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { 
  User,
  MapPin,
  CreditCard,
  Bell,
  HelpCircle,
  FileText,
  LogOut,
  ChevronRight,
  Settings,
  Heart,
  Gift,
  Shield,
  Star,
  Loader2
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { supabase, Cliente } from "@/lib/supabase";

const menuItems = [
  {
    title: "Mi Cuenta",
    items: [
      { icon: User, label: "Datos personales", path: "/portal/cuenta/perfil", badge: null },
      { icon: MapPin, label: "Direcciones de entrega", path: "/portal/cuenta/direcciones", badge: null },
      { icon: CreditCard, label: "Métodos de pago", path: "/portal/cuenta/pagos", badge: null },
    ]
  },
  {
    title: "Mis Compras",
    items: [
      { icon: Heart, label: "Favoritos", path: "/portal/favoritos", badge: null },
      { icon: Gift, label: "Cupones disponibles", path: "/portal/cuenta/cupones", badge: null },
    ]
  },
  {
    title: "Configuración",
    items: [
      { icon: Bell, label: "Notificaciones", path: "/portal/cuenta/notificaciones", badge: null },
      { icon: Shield, label: "Seguridad", path: "/portal/cuenta/seguridad", badge: null },
      { icon: Settings, label: "Preferencias", path: "/portal/cuenta/preferencias", badge: null },
    ]
  },
  {
    title: "Ayuda",
    items: [
      { icon: HelpCircle, label: "Centro de ayuda", path: "/portal/ayuda", badge: null },
      { icon: FileText, label: "Términos y condiciones", path: "/portal/terminos", badge: null },
    ]
  },
];

const PortalCuenta = () => {
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [stats, setStats] = useState({ pedidos: 0, favoritos: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.cliente_id) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [user]);

  const fetchData = async () => {
    setLoading(true);
    
    // Fetch cliente
    const { data: clienteData } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', user?.cliente_id)
      .single();
    
    if (clienteData) setCliente(clienteData);

    // Fetch stats
    const { count: pedidosCount } = await supabase
      .from('ordenes')
      .select('*', { count: 'exact', head: true })
      .eq('cliente_id', user?.cliente_id);

    const { count: favoritosCount } = await supabase
      .from('favoritos')
      .select('*', { count: 'exact', head: true })
      .eq('usuario_id', user?.id);

    setStats({
      pedidos: pedidosCount || 0,
      favoritos: favoritosCount || 0,
    });

    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  const creditoDisponible = cliente ? cliente.limite_credito - cliente.credito_utilizado : 0;
  const porcentajeCredito = cliente && cliente.limite_credito > 0 
    ? (cliente.credito_utilizado / cliente.limite_credito) * 100 
    : 0;

  const initials = user ? `${user.nombre?.charAt(0) || ''}${user.apellido?.charAt(0) || ''}`.toUpperCase() : 'U';

  return (
    <PortalMobileLayout title="Mi Cuenta">
      {/* Profile Header */}
      <div className="px-4 pt-4 pb-6">
        <div className="bg-gradient-to-r from-primary to-primary/80 rounded-2xl p-4 text-white">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-white" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-white/20 flex items-center justify-center">
                  <span className="text-2xl font-bold">{initials}</span>
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-semibold">{user?.nombre} {user?.apellido}</h2>
                  <p className="text-sm opacity-90">{user?.email}</p>
                  {cliente && (
                    <div className="flex items-center gap-2 mt-1">
                      <Badge className="bg-white/20 text-white text-xs">{cliente.tipo_negocio}</Badge>
                    </div>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-white/20">
                <div className="text-center">
                  <p className="text-2xl font-bold">{stats.pedidos}</p>
                  <p className="text-xs opacity-80">Pedidos</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{stats.favoritos}</p>
                  <p className="text-xs opacity-80">Favoritos</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Credit Line Card */}
      {cliente && cliente.limite_credito > 0 && (
        <div className="px-4 mb-4">
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">Línea de Crédito</span>
              <Badge variant="outline" className="text-green-500 border-green-500">Activa</Badge>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-primary">{formatPrice(creditoDisponible)}</span>
              <span className="text-sm text-muted-foreground">disponible</span>
            </div>
            <div className="h-2 bg-muted rounded-full mt-2 overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${porcentajeCredito}%` }} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatPrice(cliente.credito_utilizado)} utilizado de {formatPrice(cliente.limite_credito)}
            </p>
          </div>
        </div>
      )}

      {/* Menu Sections */}
      <div className="px-4 space-y-6 pb-6">
        {menuItems.map((section, sectionIndex) => (
          <div key={sectionIndex}>
            <h3 className="text-sm font-medium text-muted-foreground mb-2 px-1">
              {section.title}
            </h3>
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              {section.items.map((item, itemIndex) => (
                <Link
                  key={itemIndex}
                  to={item.path}
                  className="flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors border-b border-border last:border-0"
                >
                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                    <item.icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <span className="flex-1 font-medium">{item.label}</span>
                  {item.badge && (
                    <Badge variant="secondary" className="mr-2">{item.badge}</Badge>
                  )}
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </Link>
              ))}
            </div>
          </div>
        ))}

        {/* Logout Button */}
        <button 
          onClick={handleLogout}
          className="w-full bg-card rounded-xl border border-border p-4 flex items-center gap-3 text-red-500"
        >
          <div className="h-10 w-10 rounded-full bg-red-500/10 flex items-center justify-center">
            <LogOut className="h-5 w-5" />
          </div>
          <span className="font-medium">Cerrar Sesión</span>
        </button>

        {/* App Version */}
        <p className="text-center text-xs text-muted-foreground">
          GUDS App v1.0.0
        </p>
      </div>
    </PortalMobileLayout>
  );
};

export default PortalCuenta;
