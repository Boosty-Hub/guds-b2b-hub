import { lazy, type ComponentType } from "react";
import { Routes, Route, Navigate, matchPath } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";

// Rutas del panel de administración (/admin/*). Viven en su propio módulo para que la tabla de rutas y las cargas
// perezosas de sus ~60 pantallas no pesen en el paquete principal que descargan los portales del cliente y del vendedor.
// App.tsx precarga este módulo cuando la app se abre en /admin/…, y este módulo precarga la pantalla de esa URL.

const paginas: { ruta: string; cargar: () => Promise<unknown> }[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pagina<T extends ComponentType<any>>(rutas: string[], cargar: () => Promise<{ default: T }>) {
  for (const ruta of rutas) paginas.push({ ruta, cargar });
  return lazy(cargar);
}

const Index = pagina(["dashboard"], () => import("../pages/Index"));
const Reportes = pagina(["reportes"], () => import("../pages/Reportes"));
const Ordenes = pagina(["ordenes"], () => import("../pages/Ordenes"));
const Clientes = pagina(["clientes"], () => import("../pages/Clientes"));
const ClienteDetalle = pagina(["clientes/:clienteId"], () => import("../pages/ClienteDetalle"));
const ClienteUsuarios = pagina(["clientes/:clienteId/usuarios"], () => import("../pages/ClienteUsuarios"));
const Contactos = pagina(["contactos"], () => import("../pages/Contactos"));
const Vendedores = pagina(["vendedores"], () => import("../pages/Vendedores"));
const VendedorDetalle = pagina(["vendedores/:vendedorId"], () => import("../pages/VendedorDetalle"));
const Productos = pagina(["productos"], () => import("../pages/Productos"));
const Inventario = pagina(["inventario"], () => import("../pages/Inventario"));
const Almacenes = pagina(["almacenes"], () => import("../pages/Almacenes"));
const AlmacenDetalle = pagina(["almacenes/:almacenId"], () => import("../pages/AlmacenDetalle"));
const Transferencias = pagina(["transferencias"], () => import("../pages/Transferencias"));
const TransferenciaDetalle = pagina(["transferencias/:transferenciaId"], () => import("../pages/TransferenciaDetalle"));
const LoteDetalle = pagina(["lotes/:loteId"], () => import("../pages/LoteDetalle"));
const Consignacion = pagina(["consignacion"], () => import("../pages/Consignacion"));
const Precios = pagina(["precios"], () => import("../pages/Precios"));
const ListaPreciosDetalle = pagina(["precios/listas/:listaId"], () => import("../pages/ListaPreciosDetalle"));
const Cuentas = pagina(["cuentas"], () => import("../pages/Cuentas"));
const CuentaDetalle = pagina(["cuentas/:clienteId"], () => import("../pages/CuentaDetalle"));
const Pagos = pagina(["pagos"], () => import("../pages/Pagos"));
const CuentasPorCobrar = pagina(["cuentas-por-cobrar"], () => import("../pages/CuentasPorCobrar"));
const Facturas = pagina(["facturas"], () => import("../pages/Facturas"));
const FacturaDetalle = pagina(["facturas/:facturaId"], () => import("../pages/FacturaDetalle"));
const NotasCredito = pagina(["notas-credito"], () => import("../pages/NotasCredito"));
const Retenciones = pagina(["retenciones"], () => import("../pages/Retenciones"));
const Bancos = pagina(["bancos"], () => import("../pages/Bancos"));
const BancoDetalle = pagina(["bancos/:bancoId"], () => import("../pages/BancoDetalle"));
const Proveedores = pagina(["proveedores"], () => import("../pages/Proveedores"));
const ProveedorDetalle = pagina(["proveedores/:proveedorId"], () => import("../pages/ProveedorDetalle"));
const CuentasPorPagar = pagina(["cuentas-por-pagar"], () => import("../pages/CuentasPorPagar"));
const FacturaProveedorDetalle = pagina(["facturas-proveedor/:facturaId"], () => import("../pages/FacturaProveedorDetalle"));
const PlanPagoDetalle = pagina(["planes-pago/:planId"], () => import("../pages/PlanPagoDetalle"));
const Conciliacion = pagina(["conciliacion"], () => import("../pages/Conciliacion"));
const Cupones = pagina(["cupones"], () => import("../pages/Cupones"));
const Banners = pagina(["banners"], () => import("../pages/Banners"));
const Categorias = pagina(["categorias"], () => import("../pages/Categorias"));
const Delivery = pagina(["delivery"], () => import("../pages/Delivery"));
const HojaRuta = pagina(["delivery/hoja-ruta"], () => import("../pages/delivery/HojaRuta"));
const DevolucionesAlmacen = pagina(["delivery/devoluciones"], () => import("../pages/delivery/DevolucionesAlmacen"));
const RegistrosClientes = pagina(["registros"], () => import("../pages/RegistrosClientes"));
const Perfil = pagina(["perfil"], () => import("../pages/Perfil"));
const ConfigUsuarios = pagina(["configuracion/usuarios"], () => import("../pages/configuracion/ConfigUsuarios"));
const ConfigEmpresa = pagina(["configuracion/empresa"], () => import("../pages/configuracion/ConfigEmpresa"));
const ConfigMetodosPago = pagina(["configuracion/metodos-pago"], () => import("../pages/configuracion/ConfigMetodosPago"));
const ConfigNotificaciones = pagina(["configuracion/notificaciones"], () => import("../pages/configuracion/ConfigNotificaciones"));
const ConfigSeguridad = pagina(["configuracion/seguridad"], () => import("../pages/configuracion/ConfigSeguridad"));
const ConfigFacturacion = pagina(["configuracion/facturacion"], () => import("../pages/configuracion/ConfigFacturacion"));
const ConfigEnvios = pagina(["configuracion/envios"], () => import("../pages/configuracion/ConfigEnvios"));
const ConfigPlantillas = pagina(["configuracion/plantillas"], () => import("../pages/configuracion/ConfigPlantillas"));
const ConfigMoneda = pagina(["configuracion/moneda"], () => import("../pages/configuracion/ConfigMoneda"));
const ConfigEmpaques = pagina(["configuracion/empaques"], () => import("../pages/configuracion/ConfigEmpaques"));
const ConfigIconos = pagina(["configuracion/iconos"], () => import("../pages/configuracion/ConfigIconos"));
const ConfigDiasCaja = pagina(["configuracion/dias-caja"], () => import("../pages/configuracion/ConfigDiasCaja"));
const ConfigVerificacionOdoo = pagina(["configuracion/verificacion-odoo"], () => import("../pages/configuracion/ConfigVerificacionOdoo"));
const NotFound = lazy(() => import("../pages/NotFound"));

// Precarga la pantalla de la URL actual (la más específica si hay varias)
{
  const coinciden = paginas.filter(({ ruta }) => matchPath({ path: `/admin/${ruta}`, end: true }, window.location.pathname));
  const params = (ruta: string) => (ruta.match(/:/g) ?? []).length;
  const minimo = Math.min(...coinciden.map(({ ruta }) => params(ruta)));
  coinciden.find(({ ruta }) => params(ruta) === minimo)?.cargar().catch(() => { /* la ruta lo reintenta al montarse */ });
}

export default function RutasAdmin() {
  return (
    <Routes>
      <Route index element={<Navigate to="/admin/dashboard" replace />} />
      <Route path="dashboard" element={<ProtectedRoute allowedRoles={["admin"]}><Index /></ProtectedRoute>} />
      <Route path="reportes" element={<ProtectedRoute allowedRoles={["admin"]} modulo="reportes"><Reportes /></ProtectedRoute>} />
      <Route path="ordenes" element={<ProtectedRoute allowedRoles={["admin"]} modulo="ordenes"><Ordenes /></ProtectedRoute>} />
      <Route path="clientes" element={<ProtectedRoute allowedRoles={["admin"]} modulo="clientes"><Clientes /></ProtectedRoute>} />
      <Route path="clientes/:clienteId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="clientes"><ClienteDetalle /></ProtectedRoute>} />
      <Route path="clientes/:clienteId/usuarios" element={<ProtectedRoute allowedRoles={["admin"]} modulo="clientes"><ClienteUsuarios /></ProtectedRoute>} />
      <Route path="contactos" element={<ProtectedRoute allowedRoles={["admin"]} modulo="contactos"><Contactos /></ProtectedRoute>} />
      <Route path="vendedores" element={<ProtectedRoute allowedRoles={["admin"]} modulo="usuarios"><Vendedores /></ProtectedRoute>} />
      <Route path="vendedores/:vendedorId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="usuarios"><VendedorDetalle /></ProtectedRoute>} />
      <Route path="productos" element={<ProtectedRoute allowedRoles={["admin"]} modulo="productos"><Productos /></ProtectedRoute>} />
      <Route path="inventario" element={<ProtectedRoute allowedRoles={["admin"]} modulo="inventario"><Inventario /></ProtectedRoute>} />
      <Route path="almacenes" element={<ProtectedRoute allowedRoles={["admin"]} modulo="inventario"><Almacenes /></ProtectedRoute>} />
      <Route path="almacenes/:almacenId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="inventario"><AlmacenDetalle /></ProtectedRoute>} />
      <Route path="transferencias" element={<ProtectedRoute allowedRoles={["admin"]} modulo="inventario"><Transferencias /></ProtectedRoute>} />
      <Route path="transferencias/:transferenciaId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="inventario"><TransferenciaDetalle /></ProtectedRoute>} />
      <Route path="lotes/:loteId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="inventario"><LoteDetalle /></ProtectedRoute>} />
      <Route path="consignacion" element={<ProtectedRoute allowedRoles={["admin"]} modulo="inventario"><Consignacion /></ProtectedRoute>} />
      <Route path="precios" element={<ProtectedRoute allowedRoles={["admin"]} modulo="precios"><Precios /></ProtectedRoute>} />
      <Route path="precios/listas/:listaId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="precios"><ListaPreciosDetalle /></ProtectedRoute>} />
      <Route path="cuentas" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><Cuentas /></ProtectedRoute>} />
      <Route path="cuentas/:clienteId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><CuentaDetalle /></ProtectedRoute>} />
      <Route path="pagos" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><Pagos /></ProtectedRoute>} />
      <Route path="cuentas-por-cobrar" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><CuentasPorCobrar /></ProtectedRoute>} />
      <Route path="facturas" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><Facturas /></ProtectedRoute>} />
      <Route path="facturas/:facturaId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><FacturaDetalle /></ProtectedRoute>} />
      <Route path="notas-credito" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><NotasCredito /></ProtectedRoute>} />
      <Route path="retenciones" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cuentas"><Retenciones /></ProtectedRoute>} />
      <Route path="bancos" element={<ProtectedRoute allowedRoles={["admin"]} modulo="bancos"><Bancos /></ProtectedRoute>} />
      <Route path="bancos/:bancoId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="bancos"><BancoDetalle /></ProtectedRoute>} />
      <Route path="proveedores" element={<ProtectedRoute allowedRoles={["admin"]} modulo="compras"><Proveedores /></ProtectedRoute>} />
      <Route path="proveedores/:proveedorId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="compras"><ProveedorDetalle /></ProtectedRoute>} />
      <Route path="cuentas-por-pagar" element={<ProtectedRoute allowedRoles={["admin"]} modulo="compras"><CuentasPorPagar /></ProtectedRoute>} />
      <Route path="facturas-proveedor/:facturaId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="compras"><FacturaProveedorDetalle /></ProtectedRoute>} />
      <Route path="planes-pago/:planId" element={<ProtectedRoute allowedRoles={["admin"]} modulo="planificacion_pagos"><PlanPagoDetalle /></ProtectedRoute>} />
      <Route path="conciliacion" element={<ProtectedRoute allowedRoles={["admin"]} modulo="bancos"><Conciliacion /></ProtectedRoute>} />
      <Route path="cupones" element={<ProtectedRoute allowedRoles={["admin"]} modulo="cupones"><Cupones /></ProtectedRoute>} />
      <Route path="banners" element={<ProtectedRoute allowedRoles={["admin"]} modulo="banners"><Banners /></ProtectedRoute>} />
      <Route path="categorias" element={<ProtectedRoute allowedRoles={["admin"]} modulo="categorias"><Categorias /></ProtectedRoute>} />
      <Route path="delivery" element={<ProtectedRoute allowedRoles={["admin"]} modulo="delivery"><Delivery /></ProtectedRoute>} />
      <Route path="delivery/hoja-ruta" element={<ProtectedRoute allowedRoles={["admin"]} modulo="delivery"><HojaRuta /></ProtectedRoute>} />
      {/* Devoluciones de ruta (20p): personal con delivery o con inventario (rol Almacén); la página valida el permiso */}
      <Route path="delivery/devoluciones" element={<ProtectedRoute allowedRoles={["admin"]}><DevolucionesAlmacen /></ProtectedRoute>} />
      <Route path="registros" element={<ProtectedRoute allowedRoles={["admin"]} modulo="registros"><RegistrosClientes /></ProtectedRoute>} />
      <Route path="perfil" element={<ProtectedRoute allowedRoles={["admin"]}><Perfil /></ProtectedRoute>} />
      <Route path="configuracion" element={<ProtectedRoute allowedRoles={["admin"]}><Navigate to="/admin/configuracion/usuarios" replace /></ProtectedRoute>} />
      <Route path="configuracion/usuarios" element={<ProtectedRoute allowedRoles={["admin"]} modulo="usuarios"><ConfigUsuarios /></ProtectedRoute>} />
      <Route path="configuracion/empresa" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigEmpresa /></ProtectedRoute>} />
      <Route path="configuracion/metodos-pago" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigMetodosPago /></ProtectedRoute>} />
      <Route path="configuracion/notificaciones" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigNotificaciones /></ProtectedRoute>} />
      <Route path="configuracion/seguridad" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigSeguridad /></ProtectedRoute>} />
      <Route path="configuracion/facturacion" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigFacturacion /></ProtectedRoute>} />
      <Route path="configuracion/envios" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigEnvios /></ProtectedRoute>} />
      <Route path="configuracion/plantillas" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigPlantillas /></ProtectedRoute>} />
      <Route path="configuracion/moneda" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigMoneda /></ProtectedRoute>} />
      <Route path="configuracion/empaques" element={<ProtectedRoute allowedRoles={["admin"]} modulo="productos"><ConfigEmpaques /></ProtectedRoute>} />
      <Route path="configuracion/iconos" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigIconos /></ProtectedRoute>} />
      <Route path="configuracion/dias-caja" element={<ProtectedRoute allowedRoles={["admin"]} modulo="configuracion"><ConfigDiasCaja /></ProtectedRoute>} />
      <Route path="configuracion/verificacion-odoo" element={<ProtectedRoute allowedRoles={["admin"]}><ConfigVerificacionOdoo /></ProtectedRoute>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
