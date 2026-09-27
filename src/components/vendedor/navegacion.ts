import {
  LayoutDashboard,
  Users,
  ShoppingCart,
  CreditCard,
  Target,
  Warehouse,
  PackageCheck,
  Receipt,
} from "lucide-react";

// Menú del portal del vendedor (sidebar y accesos "Ir a" del buscador)
export const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/vendedor" },
  { icon: Users, label: "Mis Clientes", path: "/vendedor/clientes" },
  { icon: ShoppingCart, label: "Pedidos", path: "/vendedor/pedidos" },
  { icon: CreditCard, label: "Pagos", path: "/vendedor/pagos" },
  { icon: Target, label: "Mis Metas", path: "/vendedor/metas" },
  { icon: Warehouse, label: "Inventario", path: "/vendedor/inventario" },
  { icon: PackageCheck, label: "Consignación", path: "/vendedor/consignacion" },
  { icon: Receipt, label: "Retenciones", path: "/vendedor/retenciones" },
];
