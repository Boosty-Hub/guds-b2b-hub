import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { AlertCircle, Bell, Check, CheckCheck, CheckCircle, ChevronRight, Info, Loader2, Package, RefreshCw } from "lucide-react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { EstadoVacio, Segmentado, SkeletonFilas } from "@/components/portal/sistema";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications, type Notification } from "@/contexts/NotificationsContext";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

// Notificaciones del cliente (F6): la lista real de la tabla notificaciones del usuario (de la empresa activa), con
// "marcar como leída", "marcar todas" y el enlace de cada aviso (p. ej. /portal/pedidos?pedido=…). No hay preferencias de
// avisos porque no existe dónde guardarlas: se retiraron los interruptores de maqueta.

type Filtro = "todas" | "sin_leer";
const POR_PAGINA = 30;

const icono = (tipo: string | null) => {
  switch (tipo) {
    case "orden": return <Package className="h-4 w-4 text-sky-600 dark:text-sky-400" />;
    case "exito": return <CheckCircle className="h-4 w-4 text-success" />;
    case "alerta": return <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />;
    default: return <Info className="h-4 w-4 text-muted-foreground" />;
  }
};

// Solo se navega a rutas del portal (o públicas); un enlace ajeno no se abre
const enlaceValido = (link: string | null) => !!link && (link.startsWith("/portal") || link === "/terminos");

const hace = (s: string | null) => (s ? formatDistanceToNow(new Date(s), { addSuffix: true, locale: es }) : "");

const PortalNotificaciones = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { notifications: recientes, refresh } = useNotifications();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [lista, setLista] = useState<Notification[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [sinLeer, setSinLeer] = useState(0);
  const [error, setError] = useState(false);
  const [marcando, setMarcando] = useState(false);

  const pedir = useCallback(async (desde: number) => {
    if (!user?.id) return { filas: [] as Notification[], mas: false };
    let q = supabase.from("notificaciones").select("id, titulo, mensaje, tipo, leida, created_at, link")
      .eq("usuario_id", user.id).order("created_at", { ascending: false }).range(desde, desde + POR_PAGINA - 1);
    if (filtro === "sin_leer") q = q.eq("leida", false);
    const { data, error: e } = await q;
    if (e) throw e;
    const filas = (data as Notification[]) ?? [];
    return { filas, mas: filas.length === POR_PAGINA };
  }, [user?.id, filtro]);

  const contarSinLeer = useCallback(async () => {
    if (!user?.id) return;
    const { count } = await supabase.from("notificaciones").select("id", { count: "exact", head: true })
      .eq("usuario_id", user.id).eq("leida", false);
    setSinLeer(count ?? 0);
  }, [user?.id]);

  const cargar = useCallback(async () => {
    setError(false);
    try {
      const r = await pedir(0);
      setLista(r.filas);
      setHayMas(r.mas);
    } catch {
      setError(true);
    }
    contarSinLeer();
  }, [pedir, contarSinLeer]);

  useEffect(() => { setLista(null); cargar(); }, [cargar]);
  // Un aviso nuevo (llega por tiempo real a la campana) refresca la lista
  const ultimo = recientes[0]?.id;
  const ultimoVisto = useRef(ultimo);
  useEffect(() => {
    if (ultimo && ultimoVisto.current && ultimo !== ultimoVisto.current) cargar();
    ultimoVisto.current = ultimo;
  }, [ultimo]); // eslint-disable-line react-hooks/exhaustive-deps

  const verMas = async () => {
    if (!lista) return;
    setCargandoMas(true);
    try {
      const r = await pedir(lista.length);
      setLista([...lista, ...r.filas]);
      setHayMas(r.mas);
    } catch { /* se puede reintentar */ }
    setCargandoMas(false);
  };

  const marcarLeida = async (n: Notification) => {
    if (n.leida) return;
    setLista((l) => (l ? (filtro === "sin_leer" ? l.filter((x) => x.id !== n.id) : l.map((x) => (x.id === n.id ? { ...x, leida: true } : x))) : l));
    setSinLeer((c) => Math.max(0, c - 1));
    await supabase.from("notificaciones").update({ leida: true }).eq("id", n.id);
    refresh();
  };

  const abrir = (n: Notification) => {
    marcarLeida(n);
    if (enlaceValido(n.link)) navigate(n.link!);
  };

  const marcarTodas = async () => {
    if (!user?.id) return;
    setMarcando(true);
    await supabase.from("notificaciones").update({ leida: true }).eq("usuario_id", user.id).eq("leida", false);
    setMarcando(false);
    await refresh();
    cargar();
  };

  return (
    <PortalPagina titulo="Notificaciones" volver="/portal/cuenta" etiquetaVolver="Mi cuenta" ancho="estrecho"
      descripcion="Los avisos de tus pedidos, pagos y documentos."
      acciones={sinLeer > 0 ? <Button variant="outline" className="gap-2" onClick={marcarTodas} disabled={marcando}><CheckCheck className="h-4 w-4" />Marcar todas como leídas</Button> : undefined}>
      <div className="space-y-4 pb-2">
        <div className="flex items-center gap-3">
          <Segmentado<Filtro> className="flex-1 sm:max-w-xs" etiqueta="Filtrar notificaciones" valor={filtro} onCambio={setFiltro}
            opciones={[{ valor: "todas", etiqueta: "Todas" }, { valor: "sin_leer", etiqueta: "Sin leer", n: sinLeer }]} />
          {sinLeer > 0 && (
            <Button variant="ghost" size="sm" className="ml-auto gap-1.5 lg:hidden" onClick={marcarTodas} disabled={marcando}>
              <CheckCheck className="h-4 w-4" />Leer todas
            </Button>
          )}
        </div>

        {error ? (
          <div className="rounded-xl border border-border bg-card">
            <EstadoVacio icono={AlertCircle} titulo="No pudimos cargar tus notificaciones"
              accion={<Button variant="outline" className="gap-2" onClick={cargar}><RefreshCw className="h-4 w-4" />Reintentar</Button>} />
          </div>
        ) : lista === null ? (
          <SkeletonFilas n={5} alto="h-16" />
        ) : lista.length === 0 ? (
          <div className="rounded-xl border border-border bg-card">
            <EstadoVacio icono={Bell} titulo={filtro === "sin_leer" ? "No tienes notificaciones sin leer" : "No tienes notificaciones"}
              descripcion="Te avisaremos aquí y en la campana cuando cambie el estado de tus pedidos, pagos o documentos." />
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <ul className="divide-y divide-border" data-testid="notificaciones-lista">
              {lista.map((n) => {
                const conEnlace = enlaceValido(n.link);
                return (
                  <li key={n.id} className={cn("flex items-start gap-1 pr-2", !n.leida && "bg-primary/5")} data-testid="notificacion">
                    <button type="button" onClick={() => abrir(n)} className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left">
                      <span className="mt-0.5 shrink-0">{icono(n.tipo)}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-sm", !n.leida ? "font-semibold" : "font-medium")}>{n.titulo}</span>
                        {n.mensaje && <span className="mt-0.5 block text-sm text-muted-foreground">{n.mensaje}</span>}
                        <span className="mt-1 block text-xs text-muted-foreground">{hace(n.created_at)}</span>
                      </span>
                      {conEnlace && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                    </button>
                    {!n.leida && (
                      <button type="button" onClick={() => marcarLeida(n)} aria-label={`Marcar como leída: ${n.titulo}`} data-testid="marcar-leida"
                        className="mt-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Check className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {hayMas && (
              <div className="border-t border-border px-4 py-3 text-center">
                <Button variant="outline" onClick={verMas} disabled={cargandoMas} className="gap-2">
                  {cargandoMas && <Loader2 className="h-4 w-4 animate-spin" />}Ver anteriores
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </PortalPagina>
  );
};

export default PortalNotificaciones;
