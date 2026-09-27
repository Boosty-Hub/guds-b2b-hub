import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { supabase, setEmpresaHeader, type Empresa } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

// Empresa activa de la sesión (multiempresa GUDS / Quirutec).
// La selección viaja a la base en el header x-empresa-id; 'todas' = modo consulta.
export const TODAS = "todas";

interface EmpresaContextType {
  empresas: Empresa[];             // empresas permitidas al usuario
  seleccion: string;               // id de empresa o TODAS
  empresaActiva: Empresa | null;   // null en modo "Ambas"
  soloLectura: boolean;            // true en modo "Ambas"
  puedeElegirAmbas: boolean;
  cambiarEmpresa: (id: string) => void;
  version: number;                 // cambia con cada cambio de empresa (remonta las pantallas)
  recargarEmpresas: () => Promise<void>;
}

const EmpresaContext = createContext<EmpresaContextType | undefined>(undefined);

const claveGuardada = (usuarioId: string) => `guds.empresa.${usuarioId}`;
const leerGuardada = (usuarioId: string) => {
  try { return localStorage.getItem(claveGuardada(usuarioId)); } catch { return null; }
};
const guardar = (usuarioId: string, valor: string) => {
  try { localStorage.setItem(claveGuardada(usuarioId), valor); } catch { /* sin almacenamiento */ }
};

export const EmpresaProvider = ({ children }: { children: ReactNode }) => {
  const { user, loading: authLoading, updateUser } = useAuth();
  // Solo id y rol: editar el perfil (updateUser) no debe recargar las empresas ni remontar nada.
  const usuarioId = user?.id;
  const rol = user?.role;
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [seleccion, setSeleccion] = useState<string>(TODAS);
  const [version, setVersion] = useState(0);
  const [lista, setLista] = useState(false);

  // Los clientes siempre operan dentro de una empresa (su tienda); el resto puede consultar "Ambas".
  const puedeElegirAmbas = !!usuarioId && rol !== "cliente" && empresas.length > 1;

  // Un cliente presente en ambas empresas tiene una ficha por empresa: el portal usa la de la empresa activa
  const resolverCliente = useCallback(async () => {
    if (rol !== "cliente") return;
    const { data } = await supabase.rpc("mi_cliente_id");
    if (data) updateUser({ cliente_id: data as string });
  }, [rol, updateUser]);

  const cargar = useCallback(async () => {
    if (!usuarioId) {
      setEmpresaHeader(TODAS);
      setEmpresas([]);
      setSeleccion(TODAS);
      setLista(true);
      return;
    }
    const [{ data: permitidas }, { data: todas }, { data: asignadas }] = await Promise.all([
      supabase.rpc("empresas_permitidas"),
      supabase.from("empresas").select("*").eq("activo", true).order("orden"),
      supabase.from("usuario_empresas").select("empresa_id, por_defecto").eq("usuario_id", usuarioId),
    ]);
    const ids = new Set<string>((permitidas as string[] | null) ?? []);
    const mias = ((todas as Empresa[] | null) ?? []).filter((e) => ids.has(e.id));
    setEmpresas(mias);

    const guardada = leerGuardada(usuarioId);
    const valida = (v: string | null) =>
      !!v && (mias.some((e) => e.id === v) || (v === TODAS && rol !== "cliente" && mias.length > 1));
    const porDefecto = (asignadas as { empresa_id: string; por_defecto: boolean }[] | null)?.find((a) => a.por_defecto)?.empresa_id;
    const inicial = valida(guardada) ? guardada! : valida(porDefecto ?? null) ? porDefecto! : mias[0]?.id ?? TODAS;

    setEmpresaHeader(inicial);
    await resolverCliente();
    setSeleccion(inicial);
    setLista(true);
  }, [usuarioId, rol, resolverCliente]);

  useEffect(() => {
    if (authLoading) return;
    setLista(false);
    cargar();
  }, [authLoading, cargar]);

  const cambiarEmpresa = useCallback(async (id: string) => {
    if (!usuarioId || id === seleccion) return;
    // El header se cambia ANTES de re-renderizar: las pantallas remontadas ya piden con la empresa nueva.
    setEmpresaHeader(id);
    guardar(usuarioId, id);
    await resolverCliente();
    setSeleccion(id);
    setVersion((v) => v + 1);
  }, [usuarioId, seleccion, resolverCliente]);

  const value = useMemo<EmpresaContextType>(() => ({
    empresas,
    seleccion,
    empresaActiva: empresas.find((e) => e.id === seleccion) ?? null,
    soloLectura: seleccion === TODAS,
    puedeElegirAmbas,
    cambiarEmpresa,
    version,
    recargarEmpresas: cargar,
  }), [empresas, seleccion, puedeElegirAmbas, cambiarEmpresa, version, cargar]);

  // Hasta saber la empresa no se renderiza nada que consulte datos (evita pedir con la empresa equivocada).
  if (!authLoading && usuarioId && !lista) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <EmpresaContext.Provider value={value}>{children}</EmpresaContext.Provider>;
};

export const useEmpresa = () => {
  const context = useContext(EmpresaContext);
  if (context === undefined) throw new Error("useEmpresa must be used within an EmpresaProvider");
  return context;
};

// Remonta su contenido cuando cambia la empresa: cada pantalla vuelve a cargar sus datos.
export const RemontarPorEmpresa = ({ children }: { children: ReactNode }) => {
  const { version } = useEmpresa();
  return <Fragment key={version}>{children}</Fragment>;
};
