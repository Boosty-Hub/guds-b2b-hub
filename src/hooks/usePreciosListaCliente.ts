import { useCallback, useEffect, useState } from "react";
import { supabase, type Producto } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

// Precios negociados de la lista asignada al cliente ({ producto_id: precio }). Es solo para mostrar: el carrito y el
// checkout usan precio_efectivo en el servidor. Precedencia de lo que se muestra: lista del cliente > oferta > base.
export const usePreciosListaCliente = () => {
  const { user } = useAuth();
  const [lista, setLista] = useState<Record<string, number>>({});

  useEffect(() => {
    const cid = user?.cliente_id;
    if (!cid) return;
    let activo = true;
    (async () => {
      const { data: cli } = await supabase.from("clientes").select("lista_precios_id").eq("id", cid).maybeSingle();
      if (!cli?.lista_precios_id) return;
      const { data } = await supabase.from("precios_lista").select("producto_id, precio").eq("lista_precios_id", cli.lista_precios_id);
      if (activo && data) setLista(Object.fromEntries((data as { producto_id: string; precio: number }[]).map((r) => [r.producto_id, Number(r.precio)])));
    })();
    return () => { activo = false; };
  }, [user?.cliente_id]);

  const precioDe = useCallback((p: Pick<Producto, "id" | "en_oferta" | "precio_oferta" | "precio_base">) =>
    lista[p.id] != null ? lista[p.id] : p.en_oferta && p.precio_oferta ? Number(p.precio_oferta) : Number(p.precio_base), [lista]);

  return { lista, precioDe };
};
