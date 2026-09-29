import { useEffect } from "react";
import type { ProductoCarrito } from "@/hooks/useCarritoPortal";
import { cargaDiferida } from "@/lib/cargaDiferida";
import type { PropsSelectorEmpaque } from "@/components/portal/SelectorEmpaqueContenido";

// Elegir empaque antes de agregar al carrito (productos con más de un empaque). Compartido por catálogo, favoritos, inicio,
// ficha de producto y el editor de pedidos pendientes. El diálogo (Radix Dialog) se descarga aparte, cuando el navegador
// queda libre o al pedir un empaque por primera vez: no pesa en la carga de la pantalla.
const dialogo = cargaDiferida(() => import("@/components/portal/SelectorEmpaqueContenido"));

export function SelectorEmpaqueDialog<T extends ProductoCarrito>(props: PropsSelectorEmpaque<T>) {
  const modulo = dialogo.useModulo();
  const abierto = !!props.producto;
  useEffect(() => { if (abierto) dialogo.pedir(); }, [abierto]);
  return modulo ? <modulo.SelectorEmpaqueContenido {...props} /> : null;
}
