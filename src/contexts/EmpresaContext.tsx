import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { supabase, setEmpresaHeader, type Empresa } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { guardarPista, tomarAsignadas, tomarEmpresas, tomarMiClienteId } from "@/lib/arranque";

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
  const authId = user?.auth_id;
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
    // Empresas permitidas, catálogo y asignadas: normalmente ya vienen en camino desde el arranque (lib/arranque.ts)
    const [{ permitidas, todas }, asignadas] = await Promise.all([tomarEmpresas(authId), tomarAsignadas(usuarioId)]);
    const ids = new Set<string>(permitidas);
    const mias = todas.filter((e) => ids.has(e.id));
    setEmpresas(mias);

    const guardada = leerGuardada(usuarioId);
    const valida = (v: string | null) =>
      !!v && (mias.some((e) => e.id === v) || (v === TODAS && rol !== "cliente" && mias.length > 1));
    const porDefecto = asignadas.find((a) => a.por_defecto)?.empresa_id;
    const inicial = valida(guardada) ? guardada! : valida(porDefecto ?? null) ? porDefecto! : mias[0]?.id ?? TODAS;

    setEmpresaHeader(inicial);
    guardarPista(authId, rol, inicial);
    if (rol === "cliente") {
      // Ficha del cliente en la empresa activa (adelantada en el arranque si la empresa es la de la última vez)
      const clienteId = await tomarMiClienteId(authId, inicial);
      if (clienteId) updateUser({ cliente_id: clienteId });
    }
    setSeleccion(inicial);
    setLista(true);
  }, [usuarioId, authId, rol, updateUser]);

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
    guardarPista(authId, rol, id);
    await resolverCliente();
    setSeleccion(id);
    setVersion((v) => v + 1);
  }, [usuarioId, authId, rol, seleccion, resolverCliente]);

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

  // Hasta saber la sesión y la empresa no se renderiza nada que consulte datos: evita pedir con la empresa equivocada y
  // que los proveedores y la ruta se monten dos veces (antes se montaban durante la verificación de la sesión, se
  // desmontaban al esperar la empresa y se volvían a montar, repitiendo banners, configuración y categorías).
  if (authLoading || (usuarioId && !lista)) {
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
