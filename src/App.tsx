import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { CambioClaveObligatorio } from "@/components/CambioClaveObligatorio";
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
import { EmpresaProvider, RemontarPorEmpresa } from "@/contexts/EmpresaContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BoostySupport } from "@/components/support/BoostySupport";

// Public Pages
const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const RestablecerClave = lazy(() => import("./pages/RestablecerClave"));
const Registro = lazy(() => import("./pages/Registro"));
const TerminosCondiciones = lazy(() => import("./pages/TerminosCondiciones"));
const Soporte = lazy(() => import("./pages/Soporte"));
const PoliticasPrivacidad = lazy(() => import("./pages/PoliticasPrivacidad"));

// Admin Pages
const Index = lazy(() => import("./pages/Index"));
const Reportes = lazy(() => import("./pages/Reportes"));
const Ordenes = lazy(() => import("./pages/Ordenes"));
const Clientes = lazy(() => import("./pages/Clientes"));
const Productos = lazy(() => import("./pages/Productos"));
const Inventario = lazy(() => import("./pages/Inventario"));
const Almacenes = lazy(() => import("./pages/Almacenes"));
const AlmacenDetalle = lazy(() => import("./pages/AlmacenDetalle"));
const Consignacion = lazy(() => import("./pages/Consignacion"));
const Precios = lazy(() => import("./pages/Precios"));
const Cuentas = lazy(() => import("./pages/Cuentas"));
const CuentaDetalle = lazy(() => import("./pages/CuentaDetalle"));
const Pagos = lazy(() => import("./pages/Pagos"));
const CuentasPorCobrar = lazy(() => import("./pages/CuentasPorCobrar"));
const Facturas = lazy(() => import("./pages/Facturas"));
const FacturaDetalle = lazy(() => import("./pages/FacturaDetalle"));
const NotasCredito = lazy(() => import("./pages/NotasCredito"));
const Retenciones = lazy(() => import("./pages/Retenciones"));
const Bancos = lazy(() => import("./pages/Bancos"));
const Proveedores = lazy(() => import("./pages/Proveedores"));
const ProveedorDetalle = lazy(() => import("./pages/ProveedorDetalle"));
const CuentasPorPagar = lazy(() => import("./pages/CuentasPorPagar"));
const FacturaProveedorDetalle = lazy(() => import("./pages/FacturaProveedorDetalle"));
const Transferencias = lazy(() => import("./pages/Transferencias"));
const TransferenciaDetalle = lazy(() => import("./pages/TransferenciaDetalle"));
const LoteDetalle = lazy(() => import("./pages/LoteDetalle"));
const BancoDetalle = lazy(() => import("./pages/BancoDetalle"));
const Conciliacion = lazy(() => import("./pages/Conciliacion"));
const Perfil = lazy(() => import("./pages/Perfil"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Configuración Admin
const ConfigUsuarios = lazy(() => import("./pages/configuracion/ConfigUsuarios"));
const ConfigEmpresa = lazy(() => import("./pages/configuracion/ConfigEmpresa"));
const ConfigMetodosPago = lazy(() => import("./pages/configuracion/ConfigMetodosPago"));
const ConfigNotificaciones = lazy(() => import("./pages/configuracion/ConfigNotificaciones"));
const ConfigSeguridad = lazy(() => import("./pages/configuracion/ConfigSeguridad"));
const ConfigFacturacion = lazy(() => import("./pages/configuracion/ConfigFacturacion"));
const ConfigEnvios = lazy(() => import("./pages/configuracion/ConfigEnvios"));
const ConfigPlantillas = lazy(() => import("./pages/configuracion/ConfigPlantillas"));
const ConfigMoneda = lazy(() => import("./pages/configuracion/ConfigMoneda"));
const ConfigEmpaques = lazy(() => import("./pages/configuracion/ConfigEmpaques"));
const ConfigIconos = lazy(() => import("./pages/configuracion/ConfigIconos"));

// Portal de Cliente (shell responsive: ruta de diseño con barra lateral / navegación inferior)
const PortalShell = lazy(() => import("./components/portal/PortalShell"));
const PortalDashboard = lazy(() => import("./pages/portal/PortalDashboard"));
const PortalCatalogo = lazy(() => import("./pages/portal/PortalCatalogo"));
const PortalProducto = lazy(() => import("./pages/portal/PortalProducto"));
const PortalCarrito = lazy(() => import("./pages/portal/PortalCarrito"));
const PortalPedidos = lazy(() => import("./pages/portal/PortalPedidos"));
const PortalPagos = lazy(() => import("./pages/portal/PortalPagos"));
const PortalCuenta = lazy(() => import("./pages/portal/PortalCuentaMobile"));
const PortalFavoritos = lazy(() => import("./pages/portal/PortalFavoritos"));
const PortalConsignacion = lazy(() => import("./pages/portal/PortalConsignacion"));
const PortalRetenciones = lazy(() => import("./pages/portal/PortalRetenciones"));

// Portal de Cliente - Cuenta
const PortalPerfil = lazy(() => import("./pages/portal/cuenta/PortalPerfil"));
const PortalDirecciones = lazy(() => import("./pages/portal/cuenta/PortalDirecciones"));
const PortalMetodosPago = lazy(() => import("./pages/portal/cuenta/PortalMetodosPago"));
const PortalCupones = lazy(() => import("./pages/portal/cuenta/PortalCupones"));
const PortalNotificaciones = lazy(() => import("./pages/portal/cuenta/PortalNotificaciones"));
const PortalSeguridad = lazy(() => import("./pages/portal/cuenta/PortalSeguridad"));
const PortalPreferencias = lazy(() => import("./pages/portal/cuenta/PortalPreferencias"));
const PortalAyuda = lazy(() => import("./pages/portal/cuenta/PortalAyuda"));
const PortalEliminarCuenta = lazy(() => import("./pages/portal/cuenta/PortalEliminarCuenta"));

// Portal de Vendedor
const VendedorDashboard = lazy(() => import("./pages/vendedor/VendedorDashboard"));
const VendedorClientes = lazy(() => import("./pages/vendedor/VendedorClientes"));
const VendedorPedidos = lazy(() => import("./pages/vendedor/VendedorPedidos"));
const VendedorPedidoDetalle = lazy(() => import("./pages/vendedor/VendedorPedidoDetalle"));
const VendedorPagos = lazy(() => import("./pages/vendedor/VendedorPagos"));
const VendedorMetas = lazy(() => import("./pages/vendedor/VendedorMetas"));
const VendedorInventario = lazy(() => import("./pages/vendedor/VendedorInventario"));
const VendedorConsignacion = lazy(() => import("./pages/vendedor/VendedorConsignacion"));
const VendedorRetenciones = lazy(() => import("./pages/vendedor/VendedorRetenciones"));

// Admin Delivery
const Delivery = lazy(() => import("./pages/Delivery"));
const HojaRuta = lazy(() => import("./pages/delivery/HojaRuta"));

// Admin Cupones
const Cupones = lazy(() => import("./pages/Cupones"));

// Admin Banners y Categorías
const Banners = lazy(() => import("./pages/Banners"));
const Categorias = lazy(() => import("./pages/Categorias"));

// Admin Registros
const RegistrosClientes = lazy(() => import("./pages/RegistrosClientes"));

// Admin Cliente Usuarios
const ClienteUsuarios = lazy(() => import("./pages/ClienteUsuarios"));
const ClienteDetalle = lazy(() => import("./pages/ClienteDetalle"));
const Vendedores = lazy(() => import("./pages/Vendedores"));
const VendedorDetalle = lazy(() => import("./pages/VendedorDetalle"));

// Portal de Delivery
const DeliveryDashboard = lazy(() => import("./pages/delivery/DeliveryDashboard"));
const DeliveryEntregas = lazy(() => import("./pages/delivery/DeliveryEntregas"));
const DeliveryRuta = lazy(() => import("./pages/delivery/DeliveryRuta"));
const DeliveryHistorial = lazy(() => import("./pages/delivery/DeliveryHistorial"));

const queryClient = new QueryClient();

// Mientras llega el código de una ruta (cada área y cada página se cargan aparte)
const CargandoRuta = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Cargando" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <EmpresaProvider>
      <PermissionsProvider>
      <NotificationsProvider>
      <ControlTowerProvider>
      <CurrencyProvider>
        <StoreConfigProvider>
          <TooltipProvider>
            <Toaster />
            <CambioClaveObligatorio />
            <Sonner />
            <BoostySupport />
            <BrowserRouter>
              <ErrorBoundary>
              <RemontarPorEmpresa>
              <Suspense fallback={<CargandoRuta />}>
              <Routes>
                {/* Public Pages */}
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Login />} />
                <Route path="/restablecer-clave" element={<RestablecerClave />} />
                <Route path="/registro" element={<Registro />} />
                <Route path="/terminos" element={<TerminosCondiciones />} />
                <Route path="/soporte" element={<Soporte />} />
                <Route path="/privacidad" element={<PoliticasPrivacidad />} />
                
                {/* Admin Dashboard - Solo admin */}
                <Route path="/admin/dashboard" element={<ProtectedRoute allowedRoles={["admin"]}><Index /></ProtectedRoute>} />
                <Route path="/admin/reportes" element={<ProtectedRoute allowedRoles={["admin"]} modulo="reportes"><Reportes /></ProtectedRoute>} />
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
                <Route path="/admin/transferencias" element={<ProtectedRoute allowedRoles={["admin"]} modulo="inventario"><Transferencias /></ProtectedRoute>} />
                <Route path="/admin/transferencias/:transferenciaId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="inventario"><TransferenciaDetalle /></ProtectedRoute>} />
                <Route path="/admin/lotes/:loteId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="inventario"><LoteDetalle /></ProtectedRoute>} />
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
                <Route path="/admin/bancos/:bancoId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="bancos"><BancoDetalle /></ProtectedRoute>} />
                <Route path="/admin/proveedores" element={<ProtectedRoute allowedRoles={["admin"]} modulo="compras"><Proveedores /></ProtectedRoute>} />
                <Route path="/admin/proveedores/:proveedorId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="compras"><ProveedorDetalle /></ProtectedRoute>} />
                <Route path="/admin/cuentas-por-pagar" element={<ProtectedRoute allowedRoles={["admin"]} modulo="compras"><CuentasPorPagar /></ProtectedRoute>} />
                <Route path="/admin/facturas-proveedor/:facturaId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="compras"><FacturaProveedorDetalle /></ProtectedRoute>} />
                <Route path="/admin/conciliacion" element={<ProtectedRoute allowedRoles={["admin"]} modulo="bancos"><Conciliacion /></ProtectedRoute>} />
                <Route path="/admin/cupones" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cupones"><Cupones /></ProtectedRoute>} />
                <Route path="/admin/banners" element={<ProtectedRoute allowedRoles={["admin"]} modulo="banners"><Banners /></ProtectedRoute>} />
                <Route path="/admin/categorias" element={<ProtectedRoute allowedRoles={["admin"]} modulo="categorias"><Categorias /></ProtectedRoute>} />
                <Route path="/admin/delivery" element={<ProtectedRoute allowedRoles={["admin"]} modulo="delivery"><Delivery /></ProtectedRoute>} />
                <Route path="/admin/delivery/hoja-ruta" element={<ProtectedRoute allowedRoles={["admin"]} modulo="delivery"><HojaRuta /></ProtectedRoute>} />
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
          
                {/* Portal de Cliente - Solo cliente: un shell responsive (ruta de diseño) y cada página carga aparte */}
                <Route element={<ProtectedRoute allowedRoles={["cliente"]}><PortalShell /></ProtectedRoute>}>
                  <Route path="/portal" element={<PortalDashboard />} />
                  <Route path="/portal/catalogo" element={<PortalCatalogo />} />
                  <Route path="/portal/producto/:id" element={<PortalProducto />} />
                  <Route path="/portal/carrito" element={<PortalCarrito />} />
                  <Route path="/portal/pedidos" element={<PortalPedidos />} />
                  <Route path="/portal/pagos" element={<PortalPagos />} />
                  <Route path="/portal/favoritos" element={<PortalFavoritos />} />
                  <Route path="/portal/consignacion" element={<PortalConsignacion />} />
                  <Route path="/portal/retenciones" element={<PortalRetenciones />} />
                  <Route path="/portal/cuenta" element={<PortalCuenta />} />
                  <Route path="/portal/cuenta/perfil" element={<PortalPerfil />} />
                  <Route path="/portal/cuenta/direcciones" element={<PortalDirecciones />} />
                  <Route path="/portal/cuenta/pagos" element={<PortalMetodosPago />} />
                  <Route path="/portal/cuenta/cupones" element={<PortalCupones />} />
                  <Route path="/portal/cuenta/notificaciones" element={<PortalNotificaciones />} />
                  <Route path="/portal/cuenta/seguridad" element={<PortalSeguridad />} />
                  <Route path="/portal/cuenta/preferencias" element={<PortalPreferencias />} />
                  <Route path="/portal/ayuda" element={<PortalAyuda />} />
                  <Route path="/portal/cuenta/eliminar" element={<PortalEliminarCuenta />} />
                </Route>
                <Route path="/portal/terminos" element={<Navigate to="/terminos" replace />} />
          
                {/* Portal de Vendedor - Solo vendedor */}
                <Route path="/vendedor" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorDashboard /></ProtectedRoute>} />
                <Route path="/vendedor/clientes" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorClientes /></ProtectedRoute>} />
                <Route path="/vendedor/pedidos" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorPedidos /></ProtectedRoute>} />
                <Route path="/vendedor/pedidos/:id" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorPedidoDetalle /></ProtectedRoute>} />
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
              </Suspense>
              </RemontarPorEmpresa>
              </ErrorBoundary>
            </BrowserRouter>
          </TooltipProvider>
        </StoreConfigProvider>
      </CurrencyProvider>
      </ControlTowerProvider>
      </NotificationsProvider>
      </PermissionsProvider>
      </EmpresaProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
