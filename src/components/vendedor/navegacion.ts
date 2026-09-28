import {
  Sun,
  Wallet,
  Users,
  ShoppingCart,
  CreditCard,
  Target,
  Warehouse,
  PackageCheck,
  Receipt,
} from "lucide-react";

// Menú del portal del vendedor: fuente única para el sidebar, el menú del teléfono y los accesos "Ir a" del buscador
export const navItems = [
  { icon: Sun, label: "Hoy", path: "/vendedor" },
  { icon: Wallet, label: "Cartera", path: "/vendedor/cartera" },
  { icon: Users, label: "Mis Clientes", path: "/vendedor/clientes" },
  { icon: ShoppingCart, label: "Pedidos", path: "/vendedor/pedidos" },
  { icon: CreditCard, label: "Cobros", path: "/vendedor/pagos" },
  { icon: Target, label: "Mis Metas", path: "/vendedor/metas" },
  { icon: Warehouse, label: "Inventario", path: "/vendedor/inventario" },
  { icon: PackageCheck, label: "Consignación", path: "/vendedor/consignacion" },
  { icon: Receipt, label: "Retenciones", path: "/vendedor/retenciones" },
];

// Acciones frecuentes (botón central de la barra del teléfono y "Ir a" del buscador)
export const accionesRapidas = [
  { icon: ShoppingCart, label: "Nuevo pedido", path: "/vendedor/pedidos/nuevo" },
  { icon: CreditCard, label: "Registrar cobro", path: "/vendedor/cobros/nuevo" },
];
