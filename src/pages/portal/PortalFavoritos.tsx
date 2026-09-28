import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, LayoutGrid } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { TarjetaProducto } from "@/components/portal/TarjetaProducto";
import { SelectorEmpaqueDialog } from "@/components/portal/SelectorEmpaqueDialog";
import { EstadoVacio, SkeletonProductos } from "@/components/portal/sistema";
import { useCarritoPortal, type ProductoConEmpaques } from "@/hooks/useCarritoPortal";
import { usePreciosListaCliente } from "@/hooks/usePreciosListaCliente";

// Favoritos: los productos que el cliente repite, con el mismo carrito que el catálogo (precio_efectivo y tope de
// disponible) y el precio de su lista.

interface FavoritoDB {
  id: string;
  producto_id: string;
  created_at: string;
  producto: ProductoConEmpaques | null;
}

const PortalFavoritos = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { precioDe } = usePreciosListaCliente();
  const [favoritos, setFavoritos] = useState<FavoritoDB[] | null>(null);
  const { agregar, agregarConEmpaque, cambiarCantidad, cantidadDe, disponibleDe, empaqueProducto, empaquePrecios, cerrarEmpaque } = useCarritoPortal();

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("favoritos")
      .select("*, producto:productos(*, producto_empaques(*, tipo_empaque:tipos_empaque(*)))")
      .eq("usuario_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setFavoritos(((data as FavoritoDB[] | null) ?? []).filter((f) => f.producto)));
  }, [user?.id]);

  const quitar = async (f: FavoritoDB) => {
    setFavoritos((prev) => (prev ?? []).filter((x) => x.id !== f.id));
    const { error } = await supabase.from("favoritos").delete().eq("id", f.id);
    if (error) {
      toast({ title: "No se pudo quitar", description: error.message, variant: "destructive" });
      setFavoritos((prev) => [f, ...(prev ?? [])]);
    }
  };

  const n = favoritos?.length ?? 0;

  return (
    <PortalPagina
      titulo="Favoritos"
      descripcion={favoritos ? `${n} ${n === 1 ? "producto guardado" : "productos guardados"} para pedir rápido.` : undefined}
      acciones={<Button asChild variant="outline" className="gap-2"><Link to="/portal/catalogo"><LayoutGrid className="h-4 w-4" />Ir al catálogo</Link></Button>}
    >
      {favoritos === null ? (
        <SkeletonProductos n={4} className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4 xl:grid-cols-4" />
      ) : n === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EstadoVacio icono={Heart} titulo="Aún no tienes favoritos"
            descripcion="Marca con el corazón los productos que pides seguido para encontrarlos aquí."
            accion={<Button asChild><Link to="/portal/catalogo">Explorar el catálogo</Link></Button>} />
        </div>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground lg:hidden">{n} {n === 1 ? "producto guardado" : "productos guardados"}</p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4 xl:grid-cols-4">
            {favoritos.map((f) => {
              const p = f.producto!;
              return (
                <TarjetaProducto key={f.id} producto={p} precio={precioDe(p)} disponible={disponibleDe(p)} cantidad={cantidadDe(p.id)}
                  favorito onFavorito={() => quitar(f)} onAgregar={() => agregar(p)} onCambiar={(d) => cambiarCantidad(p, d)} />
              );
            })}
          </div>
        </>
      )}

      <SelectorEmpaqueDialog producto={empaqueProducto} precios={empaquePrecios} onElegir={agregarConEmpaque} onCerrar={cerrarEmpaque} />
    </PortalPagina>
  );
};

export default PortalFavoritos;
