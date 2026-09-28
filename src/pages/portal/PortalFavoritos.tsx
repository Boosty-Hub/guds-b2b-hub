import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Heart, LayoutGrid } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { TarjetaProducto, empaquePorDefecto } from "@/components/portal/TarjetaProducto";
import { SelectorEmpaqueDialog } from "@/components/portal/SelectorEmpaqueDialog";
import { EstadoVacio, SkeletonProductos } from "@/components/portal/sistema";
import { useCarritoPortal } from "@/hooks/useCarritoPortal";
import { invalidarFicha, pedirCatalogo, useAlcanceCatalogo, type ProductoPortal } from "@/hooks/useCatalogoPortal";

// Favoritos: los productos que el cliente repite, del más reciente al más antiguo, con el mismo carrito que el catálogo
// y el precio del servidor (catalogo_portal con los ids marcados). Los que ya no están a la venta en la empresa activa no
// aparecen.

const PortalFavoritos = () => {
  useAlcanceCatalogo();
  const { user } = useAuth();
  const { toast } = useToast();
  const [favoritos, setFavoritos] = useState<ProductoPortal[] | null>(null);
  const { agregar, agregarConEmpaque, cambiarCantidad, cantidadDe, empaqueProducto, empaquePrecios, cerrarEmpaque } = useCarritoPortal();

  useEffect(() => {
    if (!user?.id) return;
    let vivo = true;
    (async () => {
      const { data } = await supabase.from("favoritos").select("producto_id, created_at").eq("usuario_id", user.id).order("created_at", { ascending: false });
      const ids = ((data as { producto_id: string }[] | null) ?? []).map((f) => f.producto_id);
      if (!ids.length) { if (vivo) setFavoritos([]); return; }
      try {
        const pagina = await pedirCatalogo({ ids, limite: 100, orden: "nombre" });
        const orden = new Map(ids.map((id, i) => [id, i]));
        if (vivo) setFavoritos(pagina.productos.sort((a, b) => (orden.get(a.id) ?? 0) - (orden.get(b.id) ?? 0)));
      } catch (e) {
        if (vivo) { setFavoritos([]); toast({ title: "No pudimos cargar tus favoritos", description: (e as Error).message, variant: "destructive" }); }
      }
    })();
    return () => { vivo = false; };
  }, [user?.id, toast]);

  const quitar = async (p: ProductoPortal) => {
    if (!user?.id) return;
    const antes = favoritos;
    setFavoritos((prev) => (prev ?? []).filter((x) => x.id !== p.id));
    invalidarFicha(p.id);
    const { error } = await supabase.from("favoritos").delete().eq("usuario_id", user.id).eq("producto_id", p.id);
    if (error) {
      toast({ title: "No se pudo quitar", description: error.message, variant: "destructive" });
      setFavoritos(antes);
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
          <h2 className="sr-only">Productos guardados</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:gap-4 xl:grid-cols-4">
            {favoritos.map((p, i) => {
              const tipo = empaquePorDefecto(p);
              return (
                <TarjetaProducto key={p.id} producto={p} prioridad={i < 4} cantidad={cantidadDe(p.id, tipo)}
                  favorito onFavorito={() => quitar(p)} onAgregar={() => agregar(p)} onCambiar={(d) => cambiarCantidad(p, d, tipo)} />
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
