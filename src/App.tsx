import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { Loader2 } from "lucide-react";
import { BrowserRouter, Routes, Route, Navigate, matchPath } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { alQuedarLibre, despuesDePintar } from "@/lib/diferir";
import { CurrencyProvider } from "@/contexts/CurrencyContext";
import { StoreConfigProvider } from "@/contexts/StoreConfigContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { PermissionsProvider } from "@/contexts/PermissionsContext";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import { ControlTowerProvider } from "@/contexts/ControlTowerContext";
import { EmpresaProvider, RemontarPorEmpresa } from "@/contexts/EmpresaContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BoostySupport } from "@/components/support/BoostySupport";

// Precarga del código de la ruta de entrada: las pantallas de los portales (y el módulo de rutas del admin) registran su
// ruta y, si la URL con la que se abre la app coincide, su código se pide en paralelo con la sesión y la empresa, en vez
// de esperar a que termine ese arranque. Así la pantalla se pinta apenas hay empresa.
const rutasPrecarga: { ruta: string; cargar: () => Promise<unknown> }[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyRuta<T extends ComponentType<any>>(rutas: string[], cargar: () => Promise<{ default: T }>) {
  for (const ruta of rutas) rutasPrecarga.push({ ruta, cargar });
  return lazy(cargar);
}

// Public Pages
const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const RestablecerClave = lazy(() => import("./pages/RestablecerClave"));
const Registro = lazy(() => import("./pages/Registro"));
const TerminosCondiciones = lazy(() => import("./pages/TerminosCondiciones"));
const Soporte = lazy(() => import("./pages/Soporte"));
const PoliticasPrivacidad = lazy(() => import("./pages/PoliticasPrivacidad"));
// Estado de cuenta público por enlace (sin sesión, revocable): fase 20w
const EstadoCuentaPublico = lazyRuta(["/estado-cuenta/:token"], () => import("./pages/EstadoCuentaPublico"));

// Panel de administración: tabla de rutas y páginas en su propio módulo (fuera del paquete principal de los portales)
const RutasAdmin = lazyRuta(["/admin/*"], () => import("./rutas/RutasAdmin"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Portal de Cliente (shell responsive: ruta de diseño con barra lateral / navegación inferior)
const PortalShell = lazyRuta(["/portal/*"], () => import("./components/portal/PortalShell"));
const PortalDashboard = lazyRuta(["/portal"], () => import("./pages/portal/PortalDashboard"));
const PortalCatalogo = lazyRuta(["/portal/catalogo"], () => import("./pages/portal/PortalCatalogo"));
const PortalProducto = lazyRuta(["/portal/producto/:id"], () => import("./pages/portal/PortalProducto"));
const PortalCarrito = lazyRuta(["/portal/carrito"], () => import("./pages/portal/PortalCarrito"));
const PortalPedidos = lazyRuta(["/portal/pedidos"], () => import("./pages/portal/PortalPedidos"));
const PortalPagos = lazyRuta(["/portal/pagos"], () => import("./pages/portal/PortalPagos"));
const PortalEstadoCuenta = lazyRuta(["/portal/finanzas"], () => import("./pages/portal/PortalEstadoCuenta"));
const PortalFacturas = lazyRuta(["/portal/facturas"], () => import("./pages/portal/PortalFacturas"));
const PortalFacturaDetalle = lazyRuta(["/portal/facturas/:id"], () => import("./pages/portal/PortalFacturaDetalle"));
const PortalCuenta = lazyRuta(["/portal/cuenta"], () => import("./pages/portal/PortalCuentaMobile"));
const PortalFavoritos = lazyRuta(["/portal/favoritos"], () => import("./pages/portal/PortalFavoritos"));
const PortalConsignacion = lazyRuta(["/portal/consignacion"], () => import("./pages/portal/PortalConsignacion"));
const PortalRetenciones = lazyRuta(["/portal/retenciones"], () => import("./pages/portal/PortalRetenciones"));

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
const VendedorDashboard = lazyRuta(["/vendedor"], () => import("./pages/vendedor/VendedorDashboard"));
const VendedorClientes = lazyRuta(["/vendedor/clientes"], () => import("./pages/vendedor/VendedorClientes"));
const VendedorPedidos = lazyRuta(["/vendedor/pedidos"], () => import("./pages/vendedor/VendedorPedidos"));
const VendedorPedidoDetalle = lazyRuta(["/vendedor/pedidos/:id"], () => import("./pages/vendedor/VendedorPedidoDetalle"));
const VendedorPedidoNuevo = lazyRuta(["/vendedor/pedidos/nuevo"], () => import("./pages/vendedor/VendedorPedidoNuevo"));
const VendedorClienteFicha = lazyRuta(["/vendedor/clientes/:id"], () => import("./pages/vendedor/VendedorClienteFicha"));
const VendedorCartera = lazyRuta(["/vendedor/cartera"], () => import("./pages/vendedor/VendedorCartera"));
const VendedorCobroNuevo = lazyRuta(["/vendedor/cobros/nuevo"], () => import("./pages/vendedor/VendedorCobroNuevo"));
const VendedorPagos = lazyRuta(["/vendedor/pagos"], () => import("./pages/vendedor/VendedorPagos"));
const VendedorMetas = lazyRuta(["/vendedor/metas"], () => import("./pages/vendedor/VendedorMetas"));
const VendedorInventario = lazyRuta(["/vendedor/inventario"], () => import("./pages/vendedor/VendedorInventario"));
const VendedorConsignacion = lazyRuta(["/vendedor/consignacion"], () => import("./pages/vendedor/VendedorConsignacion"));
const VendedorRetenciones = lazyRuta(["/vendedor/retenciones"], () => import("./pages/vendedor/VendedorRetenciones"));

// Portal de Delivery
const DeliveryDashboard = lazyRuta(["/delivery"], () => import("./pages/delivery/DeliveryDashboard"));
const DeliveryEntregas = lazyRuta(["/delivery/entregas"], () => import("./pages/delivery/DeliveryEntregas"));
const DeliveryRuta = lazyRuta(["/delivery/ruta"], () => import("./pages/delivery/DeliveryRuta"));
const DeliveryHistorial = lazyRuta(["/delivery/historial"], () => import("./pages/delivery/DeliveryHistorial"));

// Se pide apenas se pintó el primer cuadro (el indicador de carga), para no competir con ese primer pintado; la sesión y
// la empresa tardan bastante más, así que el código llega antes de que haga falta.
const precargarRutaInicial = () => {
  // Layouts ("/…/*") y la página que coincide; entre páginas gana la más específica (/vendedor/pedidos/nuevo, no :id)
  const coinciden = rutasPrecarga.filter(({ ruta }) => matchPath({ path: ruta, end: true }, window.location.pathname));
  const params = (ruta: string) => (ruta.match(/:/g) ?? []).length;
  const paginas = coinciden.filter(({ ruta }) => !ruta.endsWith("/*"));
  const minimo = Math.min(...paginas.map(({ ruta }) => params(ruta)));
  for (const { ruta, cargar } of coinciden) {
    if (ruta.endsWith("/*") || params(ruta) === minimo) cargar().catch(() => { /* la ruta lo reintenta al montarse */ });
  }
};
const PrecargaRutaInicial = () => {
  useEffect(() => despuesDePintar(precargarRutaInicial, 0), []);
  return null;
};

// Piezas que no hacen falta para pintar la primera pantalla: se cargan aparte, fuera del paquete principal.
const Toaster = lazy(() => import("@/components/ui/toaster").then((m) => ({ default: m.Toaster })));
const Sonner = lazy(() => import("@/components/ui/sonner").then((m) => ({ default: m.Toaster })));
const CambioClaveObligatorio = lazy(() => import("@/components/CambioClaveObligatorio").then((m) => ({ default: m.CambioClaveObligatorio })));

/** Avisos emergentes (toast): se montan con el primer aviso o cuando el navegador queda libre tras la carga. */
const AvisosEmergentes = () => {
  const { toasts } = useToast();
  const [libre, setLibre] = useState(false);
  useEffect(() => alQuedarLibre(() => setLibre(true)), []);
  const montar = libre || toasts.length > 0;
  return montar ? (
    <Suspense fallback={null}>
      <Toaster />
      <Sonner />
    </Suspense>
  ) : null;
};

/** Cambio de contraseña obligatorio: el diálogo solo se descarga si la cuenta entró con una clave temporal. */
const CambioClaveSiHaceFalta = () => {
  const { user } = useAuth();
  if (!user?.debe_cambiar_clave) return null;
  return (
    <Suspense fallback={null}>
      <CambioClaveObligatorio />
    </Suspense>
  );
};

// Mientras llega el código de una ruta (cada área y cada página se cargan aparte)
const CargandoRuta = () => (
  <div className="flex min-h-screen items-center justify-center bg-background">
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Cargando" />
  </div>
);

const App = () => (
    <AuthProvider>
      <PrecargaRutaInicial />
      <EmpresaProvider>
      <PermissionsProvider>
      <NotificationsProvider>
      <ControlTowerProvider>
      <CurrencyProvider>
        <StoreConfigProvider>
            <AvisosEmergentes />
            <CambioClaveSiHaceFalta />
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
                <Route path="/estado-cuenta/:token" element={<EstadoCuentaPublico />} />
                
                {/* Panel de administración (solo admin): sus rutas y páginas se descargan aparte (rutas/RutasAdmin) */}
                <Route path="/admin/*" element={<RutasAdmin />} />

                {/* Portal de Cliente - Solo cliente: un shell responsive (ruta de diseño) y cada página carga aparte */}
                <Route element={<ProtectedRoute allowedRoles={["cliente"]}><PortalShell /></ProtectedRoute>}>
                  <Route path="/portal" element={<PortalDashboard />} />
                  <Route path="/portal/catalogo" element={<PortalCatalogo />} />
                  <Route path="/portal/producto/:id" element={<PortalProducto />} />
                  <Route path="/portal/carrito" element={<PortalCarrito />} />
                  <Route path="/portal/pedidos" element={<PortalPedidos />} />
                  <Route path="/portal/pagos" element={<PortalPagos />} />
                  <Route path="/portal/finanzas" element={<PortalEstadoCuenta />} />
                  <Route path="/portal/facturas" element={<PortalFacturas />} />
                  <Route path="/portal/facturas/:id" element={<PortalFacturaDetalle />} />
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
                <Route path="/vendedor/clientes/:id" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorClienteFicha /></ProtectedRoute>} />
                <Route path="/vendedor/cartera" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorCartera /></ProtectedRoute>} />
                <Route path="/vendedor/pedidos" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorPedidos /></ProtectedRoute>} />
                <Route path="/vendedor/pedidos/nuevo" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorPedidoNuevo /></ProtectedRoute>} />
                <Route path="/vendedor/pedidos/:id" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorPedidoDetalle /></ProtectedRoute>} />
                <Route path="/vendedor/cobros/nuevo" element={<ProtectedRoute allowedRoles={["vendedor"]}><VendedorCobroNuevo /></ProtectedRoute>} />
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
        </StoreConfigProvider>
      </CurrencyProvider>
      </ControlTowerProvider>
      </NotificationsProvider>
      </PermissionsProvider>
      </EmpresaProvider>
    </AuthProvider>
);

export default App;
