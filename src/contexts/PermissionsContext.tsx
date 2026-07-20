import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

type Accion = "ver" | "crear" | "editar" | "eliminar";
type PermMap = Record<string, { ver: boolean; crear: boolean; editar: boolean; eliminar: boolean }>;

interface PermissionsContextType {
  /** true hasta que los permisos del usuario ACTUAL están cargados */
  loading: boolean;
  esAdminTotal: boolean;
  can: (moduloCodigo: string, accion?: Accion) => boolean;
  refresh: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextType | undefined>(undefined);

export const PermissionsProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [esAdminTotal, setEsAdminTotal] = useState(false);
  const [permisos, setPermisos] = useState<PermMap>({});

  const load = async () => {
    const uid = user?.id ?? null;
    if (!uid) { setPermisos({}); setEsAdminTotal(false); setLoadedFor(null); return; }
    const { data } = await supabase.rpc("mis_permisos");
    if (data) {
      setEsAdminTotal(!!data.es_admin_total);
      setPermisos((data.permisos || {}) as PermMap);
    } else {
      setPermisos({}); setEsAdminTotal(false);
    }
    setLoadedFor(uid);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  // "ready" solo cuando los permisos cargados corresponden al usuario actual
  const ready = !!user?.id && loadedFor === user.id;
  const loading = !!user?.id && !ready;

  const can = (moduloCodigo: string, accion: Accion = "ver") => {
    if (!ready) return true;         // optimista mientras carga (el servidor es la barrera real)
    if (esAdminTotal) return true;   // el Administrador siempre puede
    return !!permisos[moduloCodigo]?.[accion];
  };

  return (
    <PermissionsContext.Provider value={{ loading, esAdminTotal, can, refresh: load }}>
      {children}
    </PermissionsContext.Provider>
  );
};

export const usePermissions = () => {
  const ctx = useContext(PermissionsContext);
  if (ctx === undefined) throw new Error("usePermissions must be used within a PermissionsProvider");
  return ctx;
};
