import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { TarjetaProducto, empaquePorDefecto } from "@/components/portal/TarjetaProducto";
import { SelectorEmpaqueDialog } from "@/components/portal/SelectorEmpaqueDialog";
import { useCarritoPortal } from "@/hooks/useCarritoPortal";
import { pedirCatalogo, type ProductoPortal } from "@/hooks/useCatalogoPortal";
import { EncabezadoDestacados, SkeletonDestacados } from "@/components/portal/sistema";

// Productos destacados del inicio del portal (precio del servidor, catalogo_portal) con su carrito. Se descarga y se pide
// cuando el resumen del inicio ya está en pantalla: ver PortalDashboard.
export default function DestacadosInicio() {
  const { user } = useAuth();
  const { agregar, agregarConEmpaque, cambiarCantidad, cantidadDe, empaqueProducto, empaquePrecios, cerrarEmpaque } = useCarritoPortal();
  const [destacados, setDestacados] = useState<ProductoPortal[] | null>(null);

  useEffect(() => {
    let activo = true;
    pedirCatalogo({ soloDestacados: true, orden: "nombre", limite: 8 })
      .then((r) => { if (activo) setDestacados(r.productos); })
      .catch(() => { if (activo) setDestacados([]); });
    return () => { activo = false; };
  }, [user?.cliente_id]);

  if (destacados !== null && destacados.length === 0) return null;
  return (
    <>
      <section>
        <EncabezadoDestacados>
          <Link to="/portal/catalogo" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Ver todo<ArrowRight className="h-3.5 w-3.5" /></Link>
        </EncabezadoDestacados>
        {destacados === null ? (
          <SkeletonDestacados />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 lg:gap-4">
            {destacados.map((p) => {
              const tipo = empaquePorDefecto(p);
              return (
                <TarjetaProducto key={p.id} producto={p} cantidad={cantidadDe(p.id, tipo)}
                  onAgregar={() => agregar(p)} onCambiar={(d) => cambiarCantidad(p, d, tipo)} />
              );
            })}
          </div>
        )}
      </section>
      <SelectorEmpaqueDialog producto={empaqueProducto} precios={empaquePrecios} onElegir={agregarConEmpaque} onCerrar={cerrarEmpaque} />
    </>
  );
}
