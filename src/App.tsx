import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { StoreConfigProvider } from "@/contexts/StoreConfigContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";

// Public Pages
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Registro from "./pages/Registro";
import TerminosCondiciones from "./pages/TerminosCondiciones";
import Soporte from "./pages/Soporte";
import PoliticasPrivacidad from "./pages/PoliticasPrivacidad";

// Admin Pages
import Index from "./pages/Index";
import Ordenes from "./pages/Ordenes";
import Clientes from "./pages/Clientes";
import Productos from "./pages/Productos";
import Inventario from "./pages/Inventario";
import Precios from "./pages/Precios";
import Cuentas from "./pages/Cuentas";
import Perfil from "./pages/Perfil";
import NotFound from "./pages/NotFound";

// Configuración Admin
import ConfigUsuarios from "./pages/configuracion/ConfigUsuarios";
import ConfigEmpresa from "./pages/configuracion/ConfigEmpresa";
import ConfigMetodosPago from "./pages/configuracion/ConfigMetodosPago";
import ConfigNotificaciones from "./pages/configuracion/ConfigNotificaciones";
import ConfigSeguridad from "./pages/configuracion/ConfigSeguridad";
import ConfigFacturacion from "./pages/configuracion/ConfigFacturacion";
import ConfigEnvios from "./pages/configuracion/ConfigEnvios";
import ConfigPlantillas from "./pages/configuracion/ConfigPlantillas";
import ConfigMoneda from "./pages/configuracion/ConfigMoneda";
import ConfigEmpaques from "./pages/configuracion/ConfigEmpaques";
import ConfigIconos from "./pages/configuracion/ConfigIconos";

// Portal de Cliente (Mobile)
import PortalDashboard from "./pages/portal/PortalDashboard";
import PortalCatalogo from "./pages/portal/PortalCatalogo";
import PortalCarrito from "./pages/portal/PortalCarrito";
import PortalPedidos from "./pages/portal/PortalPedidos";
import PortalPagos from "./pages/portal/PortalPagos";
import PortalCuenta from "./pages/portal/PortalCuentaMobile";
import PortalFavoritos from "./pages/portal/PortalFavoritos";

// Portal de Cliente - Cuenta
import PortalPerfil from "./pages/portal/cuenta/PortalPerfil";
import PortalDirecciones from "./pages/portal/cuenta/PortalDirecciones";
import PortalMetodosPago from "./pages/portal/cuenta/PortalMetodosPago";
import PortalCupones from "./pages/portal/cuenta/PortalCupones";
import PortalNotificaciones from "./pages/portal/cuenta/PortalNotificaciones";
import PortalSeguridad from "./pages/portal/cuenta/PortalSeguridad";
import PortalPreferencias from "./pages/portal/cuenta/PortalPreferencias";
import PortalAyuda from "./pages/portal/cuenta/PortalAyuda";
import PortalEliminarCuenta from "./pages/portal/cuenta/PortalEliminarCuenta";

// Portal de Vendedor
import VendedorDashboard from "./pages/vendedor/VendedorDashboard";
import VendedorClientes from "./pages/vendedor/VendedorClientes";
import VendedorPedidos from "./pages/vendedor/VendedorPedidos";
import VendedorPagos from "./pages/vendedor/VendedorPagos";
import VendedorMetas from "./pages/vendedor/VendedorMetas";

// Admin Delivery
import Delivery from "./pages/Delivery";

// Admin Cupones
import Cupones from "./pages/Cupones";

// Admin Banners y Categorías
import Banners from "./pages/Banners";
import Categorias from "./pages/Categorias";

// Admin Registros
import RegistrosClientes from "./pages/RegistrosClientes";

// Admin Cliente Usuarios
import ClienteUsuarios from "./pages/ClienteUsuarios";

// Portal de Delivery
import DeliveryDashboard from "./pages/delivery/DeliveryDashboard";
import DeliveryEntregas from "./pages/delivery/DeliveryEntregas";
import DeliveryRuta from "./pages/delivery/DeliveryRuta";
import DeliveryHistorial from "./pages/delivery/DeliveryHistorial";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <CurrencyProvider>
        <StoreConfigProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <Routes>
                {/* Public Pages */}
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Login />} />
                <Route path="/registro" element={<Registro />} />
                <Route path="/terminos" element={<TerminosCondiciones />} />
                <Route path="/soporte" element={<Soporte />} />
                <Route path="/privacidad" element={<PoliticasPrivacidad />} />
                
                {/* Admin Dashboard - Solo admin */}
                <Route path="/admin/dashboard" element={<ProtectedRoute allowedRoles={["admin"]}><Index /></ProtectedRoute>} />
                <Route path="/admin/ordenes" element={<ProtectedRoute allowedRoles={["admin"]}><Ordenes /></ProtectedRoute>} />
                <Route path="/admin/clientes" element={<ProtectedRoute allowedRoles={["admin"]}><Clientes /></ProtectedRoute>} />
                <Route path="/admin/clientes/:clienteId/usuarios" element={<ProtectedRoute allowedRoles={["admin"]}><ClienteUsuarios /></ProtectedRoute>} />
                <Route path="/admin/productos" element={<ProtectedRoute allowedRoles={["admin"]}><Productos /></ProtectedRoute>} />
                <Route path="/admin/inventario" element={<ProtectedRoute allowedRoles={["admin"]}><Inventario /></ProtectedRoute>} />
                <Route path="/admin/precios" element={<ProtectedRoute allowedRoles={["admin"]}><Precios /></ProtectedRoute>} />
                <Route path="/admin/cuentas" element={<ProtectedRoute allowedRoles={["admin"]}><Cuentas /></ProtectedRoute>} />
                <Route path="/admin/cupones" element={<ProtectedRoute allowedRoles={["admin"]}><Cupones /></ProtectedRoute>} />
                <Route path="/admin/banners" element={<ProtectedRoute allowedRoles={["admin"]}><Banners /></ProtectedRoute>} />
                <Route path="/admin/categorias" element={<ProtectedRoute allowedRoles={["admin"]}><Categorias /></ProtectedRoute>} />
                <Route path="/admin/delivery" element={<ProtectedRoute allowedRoles={["admin"]}><Delivery /></ProtectedRoute>} />
                <Route path="/admin/registros" element={<ProtectedRoute allowedRoles={["admin"]}><RegistrosClientes /></ProtectedRoute>} />
                <Route path="/admin/perfil" element={<ProtectedRoute allowedRoles={["admin"]}><Perfil /></ProtectedRoute>} />
          
                {/* Configuración Admin - Solo admin */}
                <Route path="/admin/configuracion" element={<ProtectedRoute allowedRoles={["admin"]}><Navigate to="/admin/configuracion/usuarios" replace /></ProtectedRoute>} />
                <Route path="/admin/configuracion/usuarios" element={<ProtectedRoute allowedRoles={["admin"]}><ConfigUsuarios /></ProtectedRoute>} />
                <Route path="/admin/configuracion/empresa" element={<ProtectedRoute allowedRoles={["admin"]}><ConfigEmpresa /></ProtectedRoute>} />
                <Route path="/admin/configuracion/metodos-pago" element={<ProtectedRoute allowedRoles={["admin"]}><ConfigMetodosPago /></ProtectedRoute>} />
                <Route path="/admin/configuracion/notificaciones" element={<ProtectedRoute allowedRoles={["admin"]}><ConfigNotificaciones /></ProtectedRoute>} />
                <Route path="/admin/configuracion/seguridad" element={<ProtectedRoute allowedRoles={["admin"]}><ConfigSeguridad /></ProtectedRoute>} />
                <Route path="/admin/configuracion/facturacion" element={<ProtectedRoute allowedRoles={["admin"]}><ConfigFacturacion /></ProtectedRoute>} />
                <Route path="/admin/configuracion/envios" element={<ProtectedRoute allowedRoles={["admin"]}><ConfigEnvios /></ProtectedRoute>} />
                <Route path="/admin/configuracion/plantillas" element={<ProtectedRoute allowedRoles={["admin"]}><ConfigPlantillas /></ProtectedRoute>} />
                <Route path="/admin/configuracion/moneda" element={<ProtectedRoute allowedRoles={["admin"]}><ConfigMoneda /></ProtectedRoute>} />
                <Route path="/admin/configuracion/empaques" element={<ProtectedRoute allowedRoles={["admin"]}><ConfigEmpaques /></ProtectedRoute>} />
                <Route path="/admin/configuracion/iconos" element={<ProtectedRoute allowedRoles={["admin"]}><ConfigIconos /></ProtectedRoute>} />
          
                {/* Portal de Cliente - Solo cliente */}
                <Route path="/portal" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalDashboard /></ProtectedRoute>} />
                <Route path="/portal/catalogo" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalCatalogo /></ProtectedRoute>} />
                <Route path="/portal/carrito" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalCarrito /></ProtectedRoute>} />
                <Route path="/portal/pedidos" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalPedidos /></ProtectedRoute>} />
                <Route path="/portal/pagos" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalPagos /></ProtectedRoute>} />
                <Route path="/portal/favoritos" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalFavoritos /></ProtectedRoute>} />
                <Route path="/portal/cuenta" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalCuenta /></ProtectedRoute>} />
                <Route path="/portal/cuenta/perfil" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalPerfil /></ProtectedRoute>} />
                <Route path="/portal/cuenta/direcciones" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalDirecciones /></ProtectedRoute>} />
                <Route path="/portal/cuenta/pagos" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalMetodosPago /></ProtectedRoute>} />
                <Route path="/portal/cuenta/cupones" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalCupones /></ProtectedRoute>} />
                <Route path="/portal/cuenta/notificaciones" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalNotificaciones /></ProtectedRoute>} />
                <Route path="/portal/cuenta/seguridad" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalSeguridad /></ProtectedRoute>} />
                <Route path="/portal/cuenta/preferencias" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalPreferencias /></ProtectedRoute>} />
                <Route path="/portal/ayuda" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalAyuda /></ProtectedRoute>} />
                <Route path="/portal/cuenta/eliminar" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalEliminarCuenta /></ProtectedRoute>} />
          
                {/* Portal de Vendedor - Solo vendedor */}
                <Route path="/vendedor" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorDashboard /></ProtectedRoute>} />
                <Route path="/vendedor/clientes" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorClientes /></ProtectedRoute>} />
                <Route path="/vendedor/pedidos" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorPedidos /></ProtectedRoute>} />
                <Route path="/vendedor/pagos" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorPagos /></ProtectedRoute>} />
                <Route path="/vendedor/metas" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorMetas /></ProtectedRoute>} />
          
                {/* Portal de Delivery - Solo delivery */}
                <Route path="/delivery" element={<ProtectedRoute allowedRoles={["delivery"]}><DeliveryDashboard /></ProtectedRoute>} />
                <Route path="/delivery/entregas" element={<ProtectedRoute allowedRoles={["delivery"]}><DeliveryEntregas /></ProtectedRoute>} />
                <Route path="/delivery/ruta" element={<ProtectedRoute allowedRoles={["delivery"]}><DeliveryRuta /></ProtectedRoute>} />
                <Route path="/delivery/historial" element={<ProtectedRoute allowedRoles={["delivery"]}><DeliveryHistorial /></ProtectedRoute>} />
          
          <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </StoreConfigProvider>
      </CurrencyProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
