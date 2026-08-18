import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { StoreConfigProvider } from "@/contexts/StoreConfigContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { PermissionsProvider } from "@/contexts/PermissionsContext";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import { ControlTowerProvider } from "@/contexts/ControlTowerContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BoostySupport } from "@/components/support/BoostySupport";

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
import Almacenes from "./pages/Almacenes";
import AlmacenDetalle from "./pages/AlmacenDetalle";
import Consignacion from "./pages/Consignacion";
import Precios from "./pages/Precios";
import Cuentas from "./pages/Cuentas";
import CuentaDetalle from "./pages/CuentaDetalle";
import Pagos from "./pages/Pagos";
import CuentasPorCobrar from "./pages/CuentasPorCobrar";
import Facturas from "./pages/Facturas";
import FacturaDetalle from "./pages/FacturaDetalle";
import NotasCredito from "./pages/NotasCredito";
import Retenciones from "./pages/Retenciones";
import Bancos from "./pages/Bancos";
import Conciliacion from "./pages/Conciliacion";
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
import PortalConsignacion from "./pages/portal/PortalConsignacion";
import PortalRetenciones from "./pages/portal/PortalRetenciones";

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
import VendedorInventario from "./pages/vendedor/VendedorInventario";
import VendedorConsignacion from "./pages/vendedor/VendedorConsignacion";
import VendedorRetenciones from "./pages/vendedor/VendedorRetenciones";

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
import ClienteDetalle from "./pages/ClienteDetalle";
import Vendedores from "./pages/Vendedores";
import VendedorDetalle from "./pages/VendedorDetalle";

// Portal de Delivery
import DeliveryDashboard from "./pages/delivery/DeliveryDashboard";
import DeliveryEntregas from "./pages/delivery/DeliveryEntregas";
import DeliveryRuta from "./pages/delivery/DeliveryRuta";
import DeliveryHistorial from "./pages/delivery/DeliveryHistorial";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <PermissionsProvider>
      <NotificationsProvider>
      <ControlTowerProvider>
      <CurrencyProvider>
        <StoreConfigProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <BoostySupport />
            <BrowserRouter>
              <ErrorBoundary>
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
                <Route path="/admin/ordenes" element={<ProtectedRoute allowedRoles={["admin"]} modulo="ordenes"><Ordenes /></ProtectedRoute>} />
                <Route path="/admin/clientes" element={<ProtectedRoute allowedRoles={["admin"]} modulo="clientes"><Clientes /></ProtectedRoute>} />
                <Route path="/admin/clientes/:clienteId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="clientes"><ClienteDetalle /></ProtectedRoute>} />
                <Route path="/admin/clientes/:clienteId/usuarios" element={<ProtectedRoute allowedRoles={["admin"]} modulo="clientes"><ClienteUsuarios /></ProtectedRoute>} />
                <Route path="/admin/vendedores" element={<ProtectedRoute allowedRoles={["admin"]} modulo="usuarios"><Vendedores /></ProtectedRoute>} />
                <Route path="/admin/vendedores/:vendedorId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="usuarios"><VendedorDetalle /></ProtectedRoute>} />
                <Route path="/admin/productos" element={<ProtectedRoute allowedRoles={["admin"]} modulo="productos"><Productos /></ProtectedRoute>} />
                <Route path="/admin/inventario" element={<ProtectedRoute allowedRoles={["admin"]} modulo="inventario"><Inventario /></ProtectedRoute>} />
                <Route path="/admin/almacenes" element={<ProtectedRoute allowedRoles={["admin"]} modulo="inventario"><Almacenes /></ProtectedRoute>} />
                <Route path="/admin/almacenes/:almacenId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="inventario"><AlmacenDetalle /></ProtectedRoute>} />
                <Route path="/admin/consignacion" element={<ProtectedRoute allowedRoles={["admin"]} modulo="inventario"><Consignacion /></ProtectedRoute>} />
                <Route path="/admin/precios" element={<ProtectedRoute allowedRoles={["admin"]} modulo="precios"><Precios /></ProtectedRoute>} />
                <Route path="/admin/cuentas" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><Cuentas /></ProtectedRoute>} />
                <Route path="/admin/cuentas/:clienteId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><CuentaDetalle /></ProtectedRoute>} />
                <Route path="/admin/pagos" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><Pagos /></ProtectedRoute>} />
                <Route path="/admin/cuentas-por-cobrar" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><CuentasPorCobrar /></ProtectedRoute>} />
                <Route path="/admin/facturas" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><Facturas /></ProtectedRoute>} />
                <Route path="/admin/facturas/:facturaId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><FacturaDetalle /></ProtectedRoute>} />
                <Route path="/admin/notas-credito" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><NotasCredito /></ProtectedRoute>} />
                <Route path="/admin/retenciones" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><Retenciones /></ProtectedRoute>} />
                <Route path="/admin/bancos" element={<ProtectedRoute allowedRoles={["admin"]} modulo="bancos"><Bancos /></ProtectedRoute>} />
                <Route path="/admin/conciliacion" element={<ProtectedRoute allowedRoles={["admin"]} modulo="bancos"><Conciliacion /></ProtectedRoute>} />
                <Route path="/admin/cupones" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cupones"><Cupones /></ProtectedRoute>} />
                <Route path="/admin/banners" element={<ProtectedRoute allowedRoles={["admin"]} modulo="banners"><Banners /></ProtectedRoute>} />
                <Route path="/admin/categorias" element={<ProtectedRoute allowedRoles={["admin"]} modulo="categorias"><Categorias /></ProtectedRoute>} />
                <Route path="/admin/delivery" element={<ProtectedRoute allowedRoles={["admin"]} modulo="delivery"><Delivery /></ProtectedRoute>} />
                <Route path="/admin/registros" element={<ProtectedRoute allowedRoles={["admin"]} modulo="registros"><RegistrosClientes /></ProtectedRoute>} />
                <Route path="/admin/perfil" element={<ProtectedRoute allowedRoles={["admin"]}><Perfil /></ProtectedRoute>} />
          
                {/* Configuración Admin - Solo admin */}
                <Route path="/admin/configuracion" element={<ProtectedRoute allowedRoles={["admin"]}><Navigate to="/admin/configuracion/usuarios" replace /></ProtectedRoute>} />
                <Route path="/admin/configuracion/usuarios" element={<ProtectedRoute allowedRoles={["admin"]} modulo="usuarios"><ConfigUsuarios /></ProtectedRoute>} />
                <Route path="/admin/configuracion/empresa" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigEmpresa /></ProtectedRoute>} />
                <Route path="/admin/configuracion/metodos-pago" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigMetodosPago /></ProtectedRoute>} />
                <Route path="/admin/configuracion/notificaciones" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigNotificaciones /></ProtectedRoute>} />
                <Route path="/admin/configuracion/seguridad" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigSeguridad /></ProtectedRoute>} />
                <Route path="/admin/configuracion/facturacion" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigFacturacion /></ProtectedRoute>} />
                <Route path="/admin/configuracion/envios" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigEnvios /></ProtectedRoute>} />
                <Route path="/admin/configuracion/plantillas" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigPlantillas /></ProtectedRoute>} />
                <Route path="/admin/configuracion/moneda" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigMoneda /></ProtectedRoute>} />
                <Route path="/admin/configuracion/empaques" element={<ProtectedRoute allowedRoles={["admin"]} modulo="productos"><ConfigEmpaques /></ProtectedRoute>} />
                <Route path="/admin/configuracion/iconos" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigIconos /></ProtectedRoute>} />
          
                {/* Portal de Cliente - Solo cliente */}
                <Route path="/portal" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalDashboard /></ProtectedRoute>} />
                <Route path="/portal/catalogo" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalCatalogo /></ProtectedRoute>} />
                <Route path="/portal/carrito" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalCarrito /></ProtectedRoute>} />
                <Route path="/portal/pedidos" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalPedidos /></ProtectedRoute>} />
                <Route path="/portal/pagos" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalPagos /></ProtectedRoute>} />
                <Route path="/portal/favoritos" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalFavoritos /></ProtectedRoute>} />
                <Route path="/portal/consignacion" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalConsignacion /></ProtectedRoute>} />
                <Route path="/portal/retenciones" element={<ProtectedRoute allowedRoles={["cliente"]}><PortalRetenciones /></ProtectedRoute>} />
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
                <Route path="/vendedor/inventario" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorInventario /></ProtectedRoute>} />
                <Route path="/vendedor/consignacion" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorConsignacion /></ProtectedRoute>} />
                <Route path="/vendedor/retenciones" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorRetenciones /></ProtectedRoute>} />

                {/* Portal de Delivery - Solo delivery */}
                <Route path="/delivery" element={<ProtectedRoute allowedRoles={["delivery"]}><DeliveryDashboard /></ProtectedRoute>} />
                <Route path="/delivery/entregas" element={<ProtectedRoute allowedRoles={["delivery"]}><DeliveryEntregas /></ProtectedRoute>} />
                <Route path="/delivery/ruta" element={<ProtectedRoute allowedRoles={["delivery"]}><DeliveryRuta /></ProtectedRoute>} />
                <Route path="/delivery/historial" element={<ProtectedRoute allowedRoles={["delivery"]}><DeliveryHistorial /></ProtectedRoute>} />
          
          <Route path="*" element={<NotFound />} />
              </Routes>
              </ErrorBoundary>
            </BrowserRouter>
          </TooltipProvider>
        </StoreConfigProvider>
      </CurrencyProvider>
      </ControlTowerProvider>
      </NotificationsProvider>
      </PermissionsProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
