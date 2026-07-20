import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase";

export interface Banner {
  id: string;
  title: string;
  subtitle: string;
  bgColor: string;
  textColor: string;
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
}

const defaultBanners: Banner[] = [
  { 
    id: "BAN-001", 
    title: "20% OFF", 
    subtitle: "En aceites", 
    bgColor: "from-yellow-500 to-orange-500", 
    textColor: "white",
    link: "/portal/catalogo?cat=Aceites",
    activo: true,
    orden: 1,
    fechaInicio: "2024-01-01",
    fechaFin: "2024-12-31"
  },
  { 
    id: "BAN-002", 
    title: "Envío Gratis", 
    subtitle: "Compras +$500", 
    bgColor: "from-blue-500 to-purple-500", 
    textColor: "white",
    link: "/portal/catalogo",
    activo: true,
    orden: 2,
    fechaInicio: "2024-01-01",
    fechaFin: "2024-12-31"
  },
  { 
    id: "BAN-003", 
    title: "2x1", 
    subtitle: "Productos seleccionados", 
    bgColor: "from-green-500 to-emerald-500", 
    textColor: "white",
    link: "/portal/catalogo?promo=2x1",
    activo: true,
    orden: 3,
    fechaInicio: "2024-01-01",
    fechaFin: "2024-12-31"
  },
  { 
    id: "BAN-004", 
    title: "Nuevos Productos", 
    subtitle: "Descubre lo nuevo", 
    bgColor: "from-pink-500 to-rose-500", 
    textColor: "white",
    link: "/portal/catalogo?nuevo=true",
    activo: false,
    orden: 4,
    fechaInicio: "2024-01-01",
    fechaFin: "2024-12-31"
  },
];

const defaultCategorias: Categoria[] = [
  { id: "CAT-001", nombre: "Aceites", icono: "🫒", color: "bg-yellow-500", activo: true, orden: 1, productosCount: 12 },
  { id: "CAT-002", nombre: "Granos", icono: "🍚", color: "bg-amber-500", activo: true, orden: 2, productosCount: 18 },
  { id: "CAT-003", nombre: "Harinas", icono: "🌾", color: "bg-orange-500", activo: true, orden: 3, productosCount: 8 },
  { id: "CAT-004", nombre: "Enlatados", icono: "🥫", color: "bg-red-500", activo: true, orden: 4, productosCount: 24 },
  { id: "CAT-005", nombre: "Lácteos", icono: "🥛", color: "bg-blue-500", activo: true, orden: 5, productosCount: 15 },
  { id: "CAT-006", nombre: "Bebidas", icono: "🧃", color: "bg-green-500", activo: true, orden: 6, productosCount: 20 },
  { id: "CAT-007", nombre: "Condimentos", icono: "🧂", color: "bg-purple-500", activo: true, orden: 7, productosCount: 10 },
  { id: "CAT-008", nombre: "Pastas", icono: "🍝", color: "bg-pink-500", activo: true, orden: 8, productosCount: 6 },
  { id: "CAT-009", nombre: "Limpieza", icono: "🧹", color: "bg-cyan-500", activo: false, orden: 9, productosCount: 14 },
];

const StoreConfigContext = createContext<StoreConfigContextType | undefined>(undefined);

export const StoreConfigProvider = ({ children }: { children: ReactNode }) => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);

  // Cargar datos desde Supabase al iniciar
  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    
    // Cargar banners
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
        link: b.link || '',
        activo: b.activo,
        orden: b.orden,
        fechaInicio: b.fecha_inicio || '',
        fechaFin: b.fecha_fin || '',
      })));
    }

    // Cargar categorías con conteo de productos
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
      })));
    }
    
    setLoading(false);
  };

  const addBanner = async (banner: Omit<Banner, "id">) => {
    const { error } = await supabase
      .from('banners')
      .insert({
        titulo: banner.title,
        subtitulo: banner.subtitle,
        color_fondo: banner.bgColor,
        color_texto: banner.textColor,
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
      }}
    >
      {children}
    </StoreConfigContext.Provider>
  );
};

export const useStoreConfig = () => {
  const context = useContext(StoreConfigContext);
  if (context === undefined) {
    throw new Error("useStoreConfig must be used within a StoreConfigProvider");
  }
  return context;
};
