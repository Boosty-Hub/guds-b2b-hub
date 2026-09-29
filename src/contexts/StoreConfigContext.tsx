import { createContext, useCallback, useContext, useState, useEffect, ReactNode } from "react";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { supabase } from "@/lib/supabase";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";

export interface Banner {
  id: string;
  title: string;
  subtitle: string;
  bgColor: string;
  textColor: string;
  imagenUrl: string | null;
  link: string;
  activo: boolean;
  orden: number;
  fechaInicio: string;
  fechaFin: string;
}

export interface Categoria {
  id: string;
  nombre: string;
  icono: string;
  color: string;
  activo: boolean;
  orden: number;
  productosCount: number;
  odooId?: number | null;   // categoría de Odoo: el nombre se edita en Odoo
}

interface StoreConfigContextType {
  banners: Banner[];
  setBanners: (banners: Banner[]) => void;
  addBanner: (banner: Omit<Banner, "id">) => void;
  updateBanner: (id: string, banner: Partial<Banner>) => void;
  deleteBanner: (id: string) => void;
  
  categorias: Categoria[];
  setCategorias: (categorias: Categoria[]) => void;
  addCategoria: (categoria: Omit<Categoria, "id">) => void;
  updateCategoria: (id: string, categoria: Partial<Categoria>) => void;
  deleteCategoria: (id: string) => void;
  
  getActiveBanners: () => Banner[];
  getActiveCategories: () => Categoria[];
  /** Pide que se carguen (y se mantengan al día) banners y/o categorías. Lo llama useStoreConfig. */
  solicitar: (partes: PartesTienda) => void;
}

export interface PartesTienda {
  banners?: boolean;
  categorias?: boolean;
}

const StoreConfigContext = createContext<StoreConfigContextType | undefined>(undefined);

export const StoreConfigProvider = ({ children }: { children: ReactNode }) => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  // Banners y categorías se cargan solo cuando alguna pantalla los usa (landing, inicio del portal, banners y
  // categorías del admin). Antes se pedían en cada arranque para todos los usuarios, dos veces.
  const [pedidas, setPedidas] = useState<{ banners: boolean; categorias: boolean }>({ banners: false, categorias: false });
  const solicitar = useCallback((partes: PartesTienda) => {
    setPedidas((prev) => {
      const sig = { banners: prev.banners || !!partes.banners, categorias: prev.categorias || !!partes.categorias };
      return sig.banners === prev.banners && sig.categorias === prev.categorias ? prev : sig;
    });
  }, []);

  // Banners son por empresa: se recargan al cambiar de empresa.
  const { version: versionEmpresa } = useEmpresa();
  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionEmpresa, pedidas]);

  const fetchData = async () => {
    await Promise.all([pedidas.banners && cargarBanners(), pedidas.categorias && cargarCategorias()]);
  };

  const cargarBanners = async () => {
    const { data: bannersData } = await supabase
      .from('banners')
      .select('*')
      .order('orden');
    
    if (bannersData) {
      setBanners(bannersData.map(b => ({
        id: b.id,
        title: b.titulo,
        subtitle: b.subtitulo || '',
        bgColor: b.color_fondo,
        textColor: b.color_texto || 'white',
        imagenUrl: b.imagen_url,
        link: b.link || '',
        activo: b.activo,
        orden: b.orden,
        fechaInicio: b.fecha_inicio || '',
        fechaFin: b.fecha_fin || '',
      })));
    }
  };

  const cargarCategorias = async () => {
    // Categorías con conteo de productos
    const { data: categoriasData } = await supabase
      .from('categorias')
      .select('*, productos:productos(count)')
      .order('orden');
    
    if (categoriasData) {
      setCategorias(categoriasData.map(c => ({
        id: c.id,
        nombre: c.nombre,
        icono: c.icono || '📦',
        color: c.color || 'bg-gray-500',
        activo: c.activo,
        orden: c.orden,
        productosCount: c.productos?.[0]?.count || 0,
        odooId: c.odoo_id ?? null,
      })));
    }
  };

  useRealtimeRefetch('banners', fetchData, pedidas.banners || pedidas.categorias);
  useRealtimeRefetch('categorias', fetchData, pedidas.banners || pedidas.categorias);

  const addBanner = async (banner: Omit<Banner, "id">) => {
    const { error } = await supabase
      .from('banners')
      .insert({
        titulo: banner.title,
        subtitulo: banner.subtitle,
        color_fondo: banner.bgColor,
        color_texto: banner.textColor,
        imagen_url: banner.imagenUrl,
        link: banner.link,
        activo: banner.activo,
        orden: banner.orden,
        fecha_inicio: banner.fechaInicio,
        fecha_fin: banner.fechaFin,
      })
      .select()
      .single();

    if (error) throw new Error(error.message); // el caller lo captura y avisa
    await fetchData();
  };

  const updateBanner = async (id: string, updates: Partial<Banner>) => {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.title !== undefined) dbUpdates.titulo = updates.title;
    if (updates.subtitle !== undefined) dbUpdates.subtitulo = updates.subtitle;
    if (updates.bgColor !== undefined) dbUpdates.color_fondo = updates.bgColor;
    if (updates.textColor !== undefined) dbUpdates.color_texto = updates.textColor;
    if (updates.imagenUrl !== undefined) dbUpdates.imagen_url = updates.imagenUrl;
    if (updates.link !== undefined) dbUpdates.link = updates.link;
    if (updates.activo !== undefined) dbUpdates.activo = updates.activo;
    if (updates.orden !== undefined) dbUpdates.orden = updates.orden;
    if (updates.fechaInicio !== undefined) dbUpdates.fecha_inicio = updates.fechaInicio;
    if (updates.fechaFin !== undefined) dbUpdates.fecha_fin = updates.fechaFin;

    const { error } = await supabase.from('banners').update(dbUpdates).eq('id', id);
    if (error) throw new Error(error.message);
    await fetchData();
  };

  const deleteBanner = async (id: string) => {
    const { error } = await supabase.from('banners').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await fetchData();
  };

  const addCategoria = async (categoria: Omit<Categoria, "id">) => {
    const { error } = await supabase
      .from('categorias')
      .insert({
        nombre: categoria.nombre,
        icono: categoria.icono,
        color: categoria.color,
        activo: categoria.activo,
        orden: categoria.orden,
      });
    if (error) throw new Error(error.message);
    await fetchData();
  };

  const updateCategoria = async (id: string, updates: Partial<Categoria>) => {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.nombre !== undefined) dbUpdates.nombre = updates.nombre;
    if (updates.icono !== undefined) dbUpdates.icono = updates.icono;
    if (updates.color !== undefined) dbUpdates.color = updates.color;
    if (updates.activo !== undefined) dbUpdates.activo = updates.activo;
    if (updates.orden !== undefined) dbUpdates.orden = updates.orden;

    const { error } = await supabase.from('categorias').update(dbUpdates).eq('id', id);
    if (error) throw new Error(error.message);
    await fetchData();
  };

  const deleteCategoria = async (id: string) => {
    const { error } = await supabase.from('categorias').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await fetchData();
  };

  const getActiveBanners = () => {
    const now = new Date();
    return banners
      .filter(b => {
        if (!b.activo) return false;
        const inicio = new Date(b.fechaInicio);
        const fin = new Date(b.fechaFin);
        return now >= inicio && now <= fin;
      })
      .sort((a, b) => a.orden - b.orden);
  };

  const getActiveCategories = () => {
    return categorias
      .filter(c => c.activo)
      .sort((a, b) => a.orden - b.orden);
  };

  return (
    <StoreConfigContext.Provider
      value={{
        banners,
        setBanners,
        addBanner,
        updateBanner,
        deleteBanner,
        categorias,
        setCategorias,
        addCategoria,
        updateCategoria,
        deleteCategoria,
        getActiveBanners,
        getActiveCategories,
        solicitar,
      }}
    >
      {children}
    </StoreConfigContext.Provider>
  );
};

/** Banners y categorías de la tienda. Por defecto pide ambos; una pantalla puede pedir solo lo que muestra. */
export const useStoreConfig = (partes: PartesTienda = { banners: true, categorias: true }) => {
  const context = useContext(StoreConfigContext);
  if (context === undefined) {
    throw new Error("useStoreConfig must be used within a StoreConfigProvider");
  }
  const { solicitar } = context;
  const { banners = false, categorias = false } = partes;
  useEffect(() => { solicitar({ banners, categorias }); }, [solicitar, banners, categorias]);
  return context;
};
