import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, Link2Off, LogIn, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { EstadoVacio, SkeletonFilas } from "@/components/portal/sistema";
import { BotonPdfEstadoCuenta } from "@/components/estado-cuenta/BotonPdfEstadoCuenta";
import { EstadoCuenta } from "@/components/estado-cuenta/EstadoCuenta";
import { libroEstadoCuenta } from "@/components/estado-cuenta/excelEstadoCuenta";
import { colorEmpresa, direccionTexto, formatoRif, urlEstadoCuenta } from "@/components/estado-cuenta/formato";
import type { EmpresaEstadoCuenta, EstadoCuentaCompleto } from "@/components/estado-cuenta/tipos";
import { rpcConReintento } from "@/components/estado-cuenta/reintento";
import { BotonExcel } from "@/components/datos/BotonExcel";

// Estado de cuenta público (fase 20w): lo que ve el cliente con el enlace que le comparte GUDS, sin iniciar sesión.
// La función estado_cuenta_publico valida el token (revocable al instante) y devuelve solo el estado de cuenta de ESE
// cliente y empresa. Se recarga al abrir y cada 3 minutos (esas recargas no suman accesos). Sin enlaces al resto de la
// app salvo "Iniciar sesión" si el cliente tiene cuenta en el portal. noindex y sin referrer (el token va en la URL).
// 22c: el mismo estado de cuenta que el admin, el portal y el vendedor (componente EstadoCuenta, formato de finanzas),
// siempre al corte de hoy, con PDF y Excel. Ya no lleva el libro de movimientos.

const RECARGA_MS = 3 * 60 * 1000;

/** Metaetiquetas de la página: no indexar, no filtrar el token por Referer, título propio. */
function useCabeceraPrivada(titulo: string) {
  useEffect(() => {
    const metas = [
      ["robots", "noindex, nofollow, noarchive"],
      ["referrer", "no-referrer"],
    ].map(([name, content]) => {
      const m = document.createElement("meta");
      m.name = name; m.content = content;
      m.setAttribute("data-estado-cuenta", "");
      document.head.appendChild(m);
      return m;
    });
    return () => metas.forEach((m) => m.remove());
  }, []);
  useEffect(() => {
    const antes = document.title;
    document.title = titulo;
    return () => { document.title = antes; };
  }, [titulo]);
}

const EstadoCuentaPublico = () => {
  const { token = "" } = useParams();
  const [datos, setDatos] = useState<EstadoCuentaCompleto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [invalido, setInvalido] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contado = useRef(false);
  const turno = useRef(0);
  const ultima = useRef(0);
  const hayDatos = useRef(false);

  const cargar = useCallback(async () => {
    const mio = ++turno.current;
    setCargando(true);
    // Solo la primera carga de la visita suma un acceso; las recargas no
    const contar = !contado.current;
    contado.current = true;
    const { data, error: err } = await rpcConReintento(() => supabase.rpc("estado_cuenta_publico", {
      p_token: token, p_contar: contar, p_movimientos: false,
    }));
    if (mio !== turno.current) return;
    ultima.current = Date.now();
    if (err) {
      // Token inválido, revocado o vencido: el servidor no dice cuál
      if (/no es válido|no está disponible/i.test(err.message)) { setInvalido(true); setDatos(null); }
      else setError(hayDatos.current ? "No pudimos actualizar los datos; se muestran los anteriores." : "No pudimos cargar el estado de cuenta. Revisa tu conexión e inténtalo de nuevo.");
    } else {
      setDatos(data as EstadoCuentaCompleto);
      hayDatos.current = true;
      setInvalido(false);
      setError(null);
    }
    setCargando(false);
  }, [token]);

  useEffect(() => { cargar(); }, [cargar]);

  // Tiempo real: cada 3 minutos con la pestaña visible, y al volver a la pestaña si pasó más de un minuto
  useEffect(() => {
    if (invalido) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") cargar(); }, RECARGA_MS);
    const alVolver = () => { if (document.visibilityState === "visible" && Date.now() - ultima.current > 60_000) cargar(); };
    document.addEventListener("visibilitychange", alVolver);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", alVolver); };
  }, [cargar, invalido]);

  const empresa = datos?.empresa ?? null;
  useCabeceraPrivada(datos ? `Estado de cuenta · ${empresa?.nombre_corto ?? empresa?.nombre ?? "GUDS"}` : "Estado de cuenta");

  if (invalido) return <EnlaceNoDisponible />;

  const primeraCarga = cargando && !datos;
  const color = colorEmpresa(empresa);
  const enlace = urlEstadoCuenta(token);

  return (
    <div className="min-h-screen bg-muted/40 text-foreground">
      <div className="h-1 w-full" style={{ backgroundColor: color }} aria-hidden />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <MarcaEmpresa empresa={empresa} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{empresa?.nombre ?? (primeraCarga ? "Cargando…" : "")}</p>
              {empresa?.rif && <p className="truncate text-xs text-muted-foreground">RIF: {formatoRif(empresa.rif)}</p>}
            </div>
          </div>
          <div className="hidden gap-2 sm:flex">
            <BotonPdfEstadoCuenta datos={datos} enlace={enlace} etiqueta="PDF" className="gap-2" />
            <BotonExcel libro={() => (datos ? libroEstadoCuenta(datos) : null)} disabled={!datos} className="gap-2" data-testid="ec-excel" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-5 sm:px-6 sm:py-6">
        <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estado de cuenta</p>
            <h1 className="mt-0.5 break-words text-xl font-semibold leading-tight sm:text-2xl" data-testid="ecp-cliente">
              {datos?.cliente.nombre ?? (primeraCarga ? "Cargando…" : "—")}
            </h1>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", cargando ? "animate-pulse bg-amber-400" : error ? "bg-destructive" : "bg-emerald-500")} aria-hidden />
            <span data-testid="ecp-actualizado">
              {error && datos ? error : datos?.actualizado_at
                ? `Actualizado ${new Date(datos.actualizado_at).toLocaleTimeString("es-VE", { hour: "numeric", minute: "2-digit" })} · se actualiza solo`
                : "Cargando datos…"}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={cargar} disabled={cargando} aria-label="Actualizar ahora">
              <RefreshCw className={cn("h-4 w-4", cargando && "animate-spin")} />
            </Button>
          </div>
        </section>

        <div className="grid grid-cols-2 gap-2 sm:hidden">
          <BotonPdfEstadoCuenta datos={datos} enlace={enlace} etiqueta="PDF" className="h-11 gap-2" data-testid="ec-pdf-movil" />
          <BotonExcel libro={() => (datos ? libroEstadoCuenta(datos) : null)} disabled={!datos} className="h-11 gap-2" data-testid="ec-excel-movil" />
        </div>

        {error && !datos ? (
          <div className="rounded-xl border border-border bg-card">
            <EstadoVacio icono={AlertCircle} titulo="No pudimos cargar el estado de cuenta" descripcion={error}
              accion={<Button variant="outline" className="gap-2" onClick={cargar}><RefreshCw className="h-4 w-4" />Reintentar</Button>} />
          </div>
        ) : primeraCarga || !datos ? (
          <div className="rounded-xl border border-border bg-card p-4"><SkeletonFilas n={6} alto="h-10" /></div>
        ) : (
          <EstadoCuenta datos={datos} modo="publico" cargando={cargando} sinEmpresa testId="ecp-estado-cuenta" />
        )}

        <footer className="space-y-3 pb-6 pt-1 text-xs text-muted-foreground">
          <p>Los pagos declarados quedan pendientes hasta su verificación.</p>
          {empresa && (
            <p>
              {[empresa.nombre, empresa.rif && `RIF ${formatoRif(empresa.rif)}`, direccionTexto(empresa), empresa.telefono, empresa.email].filter(Boolean).join(" · ")}
            </p>
          )}
          {datos?.tiene_cuenta && (
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to="/login"><LogIn className="h-4 w-4" />Iniciar sesión en el portal</Link>
            </Button>
          )}
        </footer>
      </main>
    </div>
  );
};

/** Logo de la empresa: su imagen si la tiene; el de GUDS en su color; si no, sus iniciales. */
function MarcaEmpresa({ empresa }: { empresa: EmpresaEstadoCuenta | null }) {
  const color = colorEmpresa(empresa);
  if (empresa?.logo_url) return <img src={empresa.logo_url} alt={empresa.nombre_corto ?? empresa.nombre} className="h-9 w-9 shrink-0 rounded-md object-contain" />;
  if (!empresa || (empresa.prefijo ?? empresa.nombre_corto ?? "").toUpperCase() === "GUDS") return <span style={{ color }}><Logo className="h-9 w-9" /></span>;
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white" style={{ backgroundColor: color }} aria-hidden>
      {(empresa.nombre_corto ?? empresa.nombre).slice(0, 2).toUpperCase()}
    </span>
  );
}

function EnlaceNoDisponible() {
  useCabeceraPrivada("Enlace no disponible");
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center" data-testid="ecp-invalido">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted"><Link2Off className="h-6 w-6 text-muted-foreground" /></span>
        <h1 className="mt-4 text-lg font-semibold">Este enlace no es válido o ya no está disponible</h1>
        <p className="mt-2 text-sm text-muted-foreground">Es posible que haya vencido o que se haya reemplazado por uno nuevo. Pide a tu ejecutivo de cuenta un enlace actualizado.</p>
      </div>
    </div>
  );
}

export default EstadoCuentaPublico;
