import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, CheckCircle, Clock, FileText, Link2Off, LogIn, RefreshCw, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { EstadoVacio, Kpi, Panel, Segmentado, SkeletonFilas } from "@/components/portal/sistema";
import { Antiguedad, conceptoMovimiento } from "@/components/portal/finanzas";
import { condicionPagoTexto, sumarDias, type Movimiento } from "@/hooks/useFinanzasPortal";
import { BotonPdfEstadoCuenta } from "@/components/estado-cuenta/BotonPdfEstadoCuenta";
import {
  TIPO_DOCUMENTO, colorEmpresa, direccionTexto, fechaLarga, fmtUsd, textoDias, textoPeriodo, urlEstadoCuenta,
} from "@/components/estado-cuenta/formato";
import type { DocumentoAbierto, EmpresaEstadoCuenta, EstadoCuentaCompleto, MovimientoEstadoCuenta } from "@/components/estado-cuenta/tipos";
import { rpcConReintento } from "@/components/estado-cuenta/reintento";

// Estado de cuenta público (fase 20w): lo que ve el cliente con el enlace que le comparte GUDS, sin iniciar sesión.
// La función estado_cuenta_publico valida el token (revocable al instante) y devuelve solo el estado de cuenta de ESE
// cliente y empresa. Se recarga al abrir y cada 3 minutos (esas recargas no suman accesos). Sin enlaces al resto de la
// app salvo "Iniciar sesión" si el cliente tiene cuenta en el portal. noindex y sin referrer (el token va en la URL).

type Rango = "30" | "90" | "anio" | "todo";
const RECARGA_MS = 3 * 60 * 1000;
const POR_PAGINA = 40;

const hoyCaracas = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
const periodoDe = (rango: Rango, hoy: string) => {
  switch (rango) {
    case "30": return { desde: sumarDias(hoy, -30), hasta: null };
    case "90": return { desde: sumarDias(hoy, -90), hasta: null };
    case "anio": return { desde: `${hoy.slice(0, 4)}-01-01`, hasta: null };
    case "todo": return { desde: null, hasta: null };
  }
};

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
  const hoy = useMemo(hoyCaracas, []);
  const [rango, setRango] = useState<Rango>("90");
  const periodo = useMemo(() => periodoDe(rango, hoy), [rango, hoy]);
  const [datos, setDatos] = useState<EstadoCuentaCompleto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [invalido, setInvalido] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibles, setVisibles] = useState(POR_PAGINA);
  const contado = useRef(false);
  const turno = useRef(0);
  const ultima = useRef(0);
  const hayDatos = useRef(false);

  const cargar = useCallback(async () => {
    const mio = ++turno.current;
    setCargando(true);
    // Solo la primera carga de la visita suma un acceso; las recargas y los cambios de período no
    const contar = !contado.current;
    contado.current = true;
    const { data, error: err } = await rpcConReintento(() => supabase.rpc("estado_cuenta_publico", {
      p_token: token, p_desde: periodo.desde, p_hasta: periodo.hasta, p_contar: contar,
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
  }, [token, periodo.desde, periodo.hasta]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { setVisibles(POR_PAGINA); }, [periodo.desde, periodo.hasta]);

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

  const r = datos?.resumen;
  const primeraCarga = cargando && !datos;
  const color = colorEmpresa(empresa);
  const movs = [...(datos?.movimientos ?? [])].reverse();
  const enPantalla = movs.slice(0, visibles);
  const enlace = urlEstadoCuenta(token);
  const condicion = datos ? condicionPagoTexto(datos.cliente.condicion_pago, datos.cliente.dias_credito) : null;

  return (
    <div className="min-h-screen bg-muted/40 text-foreground">
      <div className="h-1 w-full" style={{ backgroundColor: color }} aria-hidden />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <MarcaEmpresa empresa={empresa} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{empresa?.nombre ?? (primeraCarga ? "Cargando…" : "")}</p>
              {empresa?.rif && <p className="truncate text-xs text-muted-foreground">RIF {empresa.rif}</p>}
            </div>
          </div>
          <BotonPdfEstadoCuenta datos={datos} enlace={enlace} className="hidden gap-2 sm:inline-flex" />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-6 sm:py-6">
        {/* Encabezado del estado de cuenta */}
        <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estado de cuenta</p>
            <h1 className="mt-0.5 break-words text-xl font-semibold leading-tight sm:text-2xl" data-testid="ecp-cliente">
              {datos?.cliente.nombre ?? (primeraCarga ? "Cargando…" : "—")}
            </h1>
            {datos && (
              <p className="mt-1 text-sm text-muted-foreground">
                {[datos.cliente.rif && `RIF ${datos.cliente.rif}`, datos.cliente.codigo && `Código ${datos.cliente.codigo}`, condicion].filter(Boolean).join(" · ")}
              </p>
            )}
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

        {error && !datos ? (
          <div className="rounded-xl border border-border bg-card">
            <EstadoVacio icono={AlertCircle} titulo="No pudimos cargar el estado de cuenta" descripcion={error}
              accion={<Button variant="outline" className="gap-2" onClick={cargar}><RefreshCw className="h-4 w-4" />Reintentar</Button>} />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi etiqueta="Saldo por pagar" icono={Wallet} cargando={primeraCarga} testId="ecp-saldo" valor={fmtUsd(r?.saldo ?? 0)}
                detalle={r ? (r.facturas_abiertas === 0 ? "Sin documentos pendientes" : `${r.facturas_abiertas} ${r.facturas_abiertas === 1 ? "documento" : "documentos"}`) : undefined} />
              <Kpi etiqueta="Vencido" icono={AlertCircle} cargando={primeraCarga} testId="ecp-vencido" valor={fmtUsd(r?.vencido ?? 0)}
                alerta={(r?.vencido ?? 0) > 0}
                detalle={r ? (r.facturas_vencidas === 0 ? "Nada vencido" : `${r.facturas_vencidas} ${r.facturas_vencidas === 1 ? "documento vencido" : "documentos vencidos"}`) : undefined} />
              <Kpi etiqueta="Por vencer" icono={Clock} cargando={primeraCarga} valor={fmtUsd(r?.por_vencer ?? 0)} detalle="Dentro del plazo" />
              <Kpi etiqueta="A favor" icono={CheckCircle} cargando={primeraCarga} valor={fmtUsd(r?.a_favor ?? 0)}
                detalle={r ? (r.a_favor <= 0 ? "Sin saldo a favor" : [r.nc_a_favor > 0 && `Notas de crédito ${fmtUsd(r.nc_a_favor)}`, r.anticipos > 0 && `Anticipos ${fmtUsd(r.anticipos)}`].filter(Boolean).join(" · ")) : undefined} />
            </div>

            <BotonPdfEstadoCuenta datos={datos} enlace={enlace} className="h-11 w-full gap-2 sm:hidden" />

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
              <Panel titulo="Antigüedad del saldo" descripcion="Días desde el vencimiento de cada documento.">
                {primeraCarga || !r ? <SkeletonFilas n={5} alto="h-8" /> : r.saldo <= 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">No hay saldo pendiente.</p>
                ) : <Antiguedad resumen={r} enlaces={false} formato={fmtUsd} />}
              </Panel>
              <Panel titulo="Resumen">
                {primeraCarga || !r ? <SkeletonFilas n={4} alto="h-6" /> : (
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Saldo por pagar</dt><dd className="tabular-nums">{fmtUsd(r.saldo)}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Saldo a favor</dt><dd className="tabular-nums">{fmtUsd(-r.a_favor)}</dd></div>
                    <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold">
                      <dt>Saldo neto</dt><dd className="tabular-nums" data-testid="ecp-neto">{fmtUsd(r.neto)}</dd>
                    </div>
                    {(r.notas_debito_abiertas ?? 0) > 0 && (
                      <p className="pt-1 text-xs text-muted-foreground">Incluye {r.notas_debito_abiertas} {r.notas_debito_abiertas === 1 ? "nota de débito" : "notas de débito"} por {fmtUsd(r.notas_debito_saldo ?? 0)}.</p>
                    )}
                  </dl>
                )}
              </Panel>
            </div>

            <Panel titulo="Documentos con saldo" descripcion="Facturas y notas de débito por pagar, y notas de crédito a favor." cuerpoClassName="p-0 sm:p-0">
              {primeraCarga ? <div className="p-4"><SkeletonFilas n={3} alto="h-12" /></div>
                : !datos?.abiertos?.length ? <p className="px-4 py-6 text-center text-sm text-muted-foreground">No hay documentos con saldo pendiente.</p>
                : <DocumentosAbiertos docs={datos.abiertos} />}
            </Panel>

            <Panel titulo="Movimientos" descripcion={datos ? `${movs.length} ${movs.length === 1 ? "movimiento" : "movimientos"} · ${textoPeriodo(datos).toLowerCase()}` : undefined}
              cuerpoClassName="p-0 sm:p-0">
              <div className="border-b border-border px-4 py-3 sm:px-5">
                <Segmentado<Rango> className="sm:max-w-md" etiqueta="Período" valor={rango} onCambio={setRango}
                  opciones={[{ valor: "30", etiqueta: "30 días" }, { valor: "90", etiqueta: "90 días" }, { valor: "anio", etiqueta: "Este año" }, { valor: "todo", etiqueta: "Todo" }]} />
              </div>
              {primeraCarga ? <div className="p-4"><SkeletonFilas n={6} alto="h-12" /></div> : !datos ? null : (
                <div className={cn("transition-opacity", cargando && "opacity-60")} aria-busy={cargando}>
                  <FilaSaldo etiqueta={`Saldo al ${fechaLarga(datos.periodo.hasta ?? datos.hoy)}`} valor={datos.saldo_final} fuerte />
                  {movs.length === 0 ? (
                    <EstadoVacio icono={FileText} titulo="Sin movimientos en este período" descripcion="Elige un período más amplio para ver movimientos anteriores." />
                  ) : (
                    <>
                      <TablaMovimientos movs={enPantalla} />
                      <ListaMovimientos movs={enPantalla} />
                      {movs.length > visibles && (
                        <div className="border-t border-border px-4 py-3 text-center">
                          <Button variant="outline" onClick={() => setVisibles((v) => v + POR_PAGINA)}>Ver movimientos anteriores ({movs.length - visibles})</Button>
                        </div>
                      )}
                    </>
                  )}
                  {datos.periodo.desde && movs.length <= visibles && (
                    <FilaSaldo etiqueta={`Saldo anterior al ${fechaLarga(datos.periodo.desde)}`} valor={datos.saldo_inicial} />
                  )}
                </div>
              )}
            </Panel>
          </>
        )}

        <footer className="space-y-3 pb-6 pt-1 text-xs text-muted-foreground">
          <p>
            Montos en dólares (USD). Los documentos en bolívares se expresan en USD a la tasa de cada documento. Los pagos declarados
            quedan pendientes hasta su verificación.
            {datos?.ajustes_cambiarios ? ` No se listan ${datos.ajustes_cambiarios} ${datos.ajustes_cambiarios === 1 ? "ajuste" : "ajustes"} por diferencial cambiario (notas en bolívares de 0,00 USD), que no cambian el saldo.` : ""}
          </p>
          {empresa && (
            <p>
              {[empresa.nombre, empresa.rif && `RIF ${empresa.rif}`, direccionTexto(empresa), empresa.telefono, empresa.email].filter(Boolean).join(" · ")}
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

function FilaSaldo({ etiqueta, valor, fuerte }: { etiqueta: string; valor: number; fuerte?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 bg-muted/40 px-4 py-2.5 text-sm sm:px-5", fuerte ? "border-b border-border font-semibold" : "border-t border-border text-muted-foreground")}>
      <span>{etiqueta}</span>
      <span className="tabular-nums" data-testid={fuerte ? "ecp-saldo-final" : undefined}>{fmtUsd(valor)}</span>
    </div>
  );
}

const claseDias = (d: DocumentoAbierto) => (d.saldo < 0 ? "text-success" : d.dias > 0 ? "text-destructive" : "text-muted-foreground");

function DocumentosAbiertos({ docs: todos }: { docs: DocumentoAbierto[] }) {
  const [todosVisibles, setTodosVisibles] = useState(false);
  const docs = todosVisibles ? todos : todos.slice(0, 10);
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full text-sm" data-testid="ecp-abiertos">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="px-5 py-2 font-medium">Documento</th>
              <th className="px-3 py-2 font-medium">Emisión</th>
              <th className="px-3 py-2 font-medium">Vence</th>
              <th className="px-3 py-2 font-medium">Situación</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-5 py-2 text-right font-medium">Saldo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {docs.map((d, i) => (
              <tr key={`${d.numero}-${i}`}>
                <td className="px-5 py-2.5"><span className="font-medium tabular-nums">{d.numero}</span><span className="ml-2 text-xs text-muted-foreground">{TIPO_DOCUMENTO[d.tipo]}</span></td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">{fechaLarga(d.emision)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">{fechaLarga(d.vence ?? d.emision)}</td>
                <td className={cn("whitespace-nowrap px-3 py-2.5", claseDias(d))}>{textoDias(d)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{fmtUsd(d.total)}</td>
                <td className={cn("whitespace-nowrap px-5 py-2.5 text-right font-semibold tabular-nums", d.saldo < 0 && "text-success")}>{fmtUsd(d.saldo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border md:hidden" data-testid="ecp-abiertos-movil">
        {docs.map((d, i) => (
          <li key={`${d.numero}-${i}`} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium"><span className="tabular-nums">{d.numero}</span> <span className="font-normal text-muted-foreground">· {TIPO_DOCUMENTO[d.tipo]}</span></p>
              <p className={cn("mt-0.5 text-xs", claseDias(d))}>{textoDias(d)}{d.saldo >= 0 && ` · ${fechaLarga(d.vence ?? d.emision)}`}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className={cn("text-sm font-semibold tabular-nums", d.saldo < 0 && "text-success")}>{fmtUsd(d.saldo)}</p>
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">de {fmtUsd(d.total)}</p>
            </div>
          </li>
        ))}
      </ul>
      {todos.length > docs.length && (
        <div className="border-t border-border px-4 py-3 text-center">
          <Button variant="outline" onClick={() => setTodosVisibles(true)} data-testid="ecp-abiertos-todos">Ver todos los documentos ({todos.length})</Button>
        </div>
      )}
    </>
  );
}

const documentoDe = (m: MovimientoEstadoCuenta) => (m.tipo === "redondeo" ? "—" : m.documento || "—");

function TablaMovimientos({ movs }: { movs: MovimientoEstadoCuenta[] }) {
  return (
    <div className="hidden md:block">
      <table className="w-full text-sm" data-testid="ecp-movimientos">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="px-5 py-2 font-medium">Fecha</th>
            <th className="px-3 py-2 font-medium">Documento</th>
            <th className="px-3 py-2 font-medium">Concepto</th>
            <th className="px-3 py-2 text-right font-medium">Cargo</th>
            <th className="px-3 py-2 text-right font-medium">Abono</th>
            <th className="px-5 py-2 text-right font-medium">Saldo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {movs.map((m, i) => (
            <tr key={`${m.tipo}-${m.documento}-${m.fecha}-${i}`} data-testid="ecp-movimiento" data-tipo={m.tipo}>
              <td className="whitespace-nowrap px-5 py-2.5 tabular-nums text-muted-foreground">{fechaLarga(m.fecha)}</td>
              <td className="px-3 py-2.5 tabular-nums">{documentoDe(m)}</td>
              <td className="px-3 py-2.5">
                {conceptoMovimiento(m as Movimiento)}
                {(m.tipo === "factura" || m.tipo === "nota_debito") && m.vence && m.estado !== "anulado" && (
                  <span className="ml-1.5 text-xs text-muted-foreground">vence {fechaLarga(m.vence)}</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{m.monto > 0 ? fmtUsd(m.monto) : ""}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-success">{m.monto < 0 ? fmtUsd(-m.monto) : ""}</td>
              <td className="whitespace-nowrap px-5 py-2.5 text-right font-medium tabular-nums">{fmtUsd(m.saldo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListaMovimientos({ movs }: { movs: MovimientoEstadoCuenta[] }) {
  return (
    <ul className="divide-y divide-border md:hidden" data-testid="ecp-movimientos-movil">
      {movs.map((m, i) => (
        <li key={`${m.tipo}-${m.documento}-${m.fecha}-${i}`} className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{conceptoMovimiento(m as Movimiento)}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{fechaLarga(m.fecha)}{m.tipo !== "redondeo" && m.documento ? ` · ${m.documento}` : ""}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className={cn("text-sm font-semibold tabular-nums", m.monto < 0 && "text-success")}>{m.monto < 0 ? `-${fmtUsd(-m.monto)}` : `+${fmtUsd(m.monto)}`}</p>
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">Saldo {fmtUsd(m.saldo)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default EstadoCuentaPublico;
