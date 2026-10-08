// Módulos de administración (sidebar y "Ir a…" del buscador global)
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  Warehouse,
  Boxes,
  Tags,
  CreditCard,
  Truck,
  Building2,
  Wallet,
  ArrowLeftRight,
  Ticket,
  Image,
  FolderOpen,
  UserPlus,
  HandCoins,
  Landmark,
  FileText,
  FileMinus,
  PackageCheck,
  Receipt,
  UserCog,
  ListChecks,
  BarChart3,
  Undo2,
  Contact,
  Trash2,
} from "lucide-react";
import type { ComponentType } from "react";

export type NavItem = { icon: ComponentType<{ className?: string }>; label: string; path: string; modulo: string };
export type NavSection = { title: string; items: NavItem[] };

export const navSections: NavSection[] = [
  {
    title: "Principal",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", path: "/admin/dashboard", modulo: "dashboard" },
      { icon: BarChart3, label: "Reportes", path: "/admin/reportes", modulo: "reportes" },
    ],
  },
  {
    title: "Ventas",
    items: [
      { icon: ShoppingCart, label: "Órdenes", path: "/admin/ordenes", modulo: "ordenes" },
      { icon: Users, label: "Clientes", path: "/admin/clientes", modulo: "clientes" },
      { icon: Contact, label: "Contactos", path: "/admin/contactos", modulo: "contactos" },
      { icon: UserCog, label: "Vendedores", path: "/admin/vendedores", modulo: "usuarios" },
      { icon: UserPlus, label: "Registros", path: "/admin/registros", modulo: "registros" },
    ],
  },
  {
    title: "Catálogo",
    items: [
      { icon: Package, label: "Productos", path: "/admin/productos", modulo: "productos" },
      { icon: FolderOpen, label: "Categorías", path: "/admin/categorias", modulo: "categorias" },
      { icon: Tags, label: "Precios", path: "/admin/precios", modulo: "precios" },
      { icon: Ticket, label: "Cupones", path: "/admin/cupones", modulo: "cupones" },
      { icon: Image, label: "Banners", path: "/admin/banners", modulo: "banners" },
    ],
  },
  {
    title: "Inventario",
    items: [
      { icon: Warehouse, label: "Inventario", path: "/admin/inventario", modulo: "inventario" },
      { icon: Boxes, label: "Almacenes", path: "/admin/almacenes", modulo: "inventario" },
      { icon: ArrowLeftRight, label: "Transferencias", path: "/admin/transferencias", modulo: "inventario" },
      { icon: PackageCheck, label: "Consignación", path: "/admin/consignacion", modulo: "inventario" },
    ],
  },
  {
    title: "Compras",
    items: [
      { icon: Building2, label: "Proveedores", path: "/admin/proveedores", modulo: "compras" },
      { icon: Wallet, label: "Cuentas por Pagar", path: "/admin/cuentas-por-pagar", modulo: "compras" },
    ],
  },
  {
    title: "Finanzas",
    items: [
      { icon: CreditCard, label: "Cuentas", path: "/admin/cuentas", modulo: "cuentas" },
      { icon: HandCoins, label: "Cuentas por Cobrar", path: "/admin/cuentas-por-cobrar", modulo: "cuentas" },
      { icon: FileText, label: "Facturas", path: "/admin/facturas", modulo: "cuentas" },
      { icon: FileMinus, label: "Notas de Crédito", path: "/admin/notas-credito", modulo: "cuentas" },
      { icon: Receipt, label: "Retenciones", path: "/admin/retenciones", modulo: "cuentas" },
      { icon: Landmark, label: "Bancos", path: "/admin/bancos", modulo: "bancos" },
      { icon: ListChecks, label: "Conciliación", path: "/admin/conciliacion", modulo: "bancos" },
      // 22d: tipo de cliente, canal y categoría de cobranza de finanzas (se guarda en Odoo); la pantalla vive en Configuración
      { icon: Tags, label: "Clasificación de clientes", path: "/admin/configuracion/clasificacion-clientes", modulo: "clasificacion_clientes" },
    ],
  },
  {
    title: "Logística",
    items: [
      { icon: Truck, label: "Delivery", path: "/admin/delivery", modulo: "delivery" },
      { icon: Undo2, label: "Devoluciones", path: "/admin/delivery/devoluciones", modulo: "inventario" },
    ],
  },
  {
    title: "Administración",
    items: [
      // Fase 22a: lo anulado o archivado (solo Administrador)
      { icon: Trash2, label: "Papelera", path: "/admin/papelera", modulo: "papelera" },
    ],
  },
];


// Accesos directos del buscador (Ctrl+K) a vistas dentro de una página: no van en el menú lateral (NavLink compara solo la
// ruta y marcaría dos ítems a la vez). `modulos`: todos los permisos que pide la vista.
export type AccesoBuscador = { label: string; path: string; seccion: string; modulos: string[] };
export const accesosBuscador: AccesoBuscador[] = [
  { label: "Lo cobrado", path: "/admin/reportes?tab=cobranza&cobranza=cobrado", seccion: "Reportes · Cobranza", modulos: ["reportes"] },
  { label: "Cobranza (resumen)", path: "/admin/reportes?tab=cobranza", seccion: "Reportes", modulos: ["reportes"] },
  { label: "Calidad y cuadre", path: "/admin/reportes?tab=calidad", seccion: "Reportes", modulos: ["reportes", "cuentas"] },
];
