import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CalendarClock, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ListChecks, Loader2, Settings2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { cn } from "@/lib/utils";
import {
  GRUPOS, type FacturaPlan, type Grupo, cargarDiasCaja, diasEntre, DIAS_SEMANA, fmtFecha, fmtFechaCorta, fmtUsd, grupoDe, hoyCaracas,
  netoSugerido, proximoDiaCaja, rangoGrupo, retPendiente, sumarDias,
} from "./comun";
import { DialogoCrearPlan } from "./DialogoCrearPlan";

interface Props {
  /** Búsqueda de la barra de la lista (proveedor, factura o referencia). */
  q: string;
  /** Filtro de proveedor compartido con las otras pestañas (null = todos). */
  proveedor: string | null;
  /** Filtro de empresa en «Ambas» (null = las dos). */
  empresa: string | null;
  onConteo?: (filas: number, total: number) => void;
}
interface GrupoProveedor {
  id: string; nombre: string; rif: string | null; facturas: FacturaPlan[]; saldo: number; vencido: number; hastaCorte: number;
  ret: number; neto: number; aFavor: number;
}

const tonoDias = (d: number) => (d < 0 ? "text-destructive" : d === 0 ? "text-warning" : "text-muted-foreground");
const textoDias = (d: number) => (d < 0 ? `${-d} d vencida` : d === 0 ? "hoy" : `en ${d} d`);

export function PlanificacionPagos({ q, proveedor, empresa, onConteo }: Props) {
  const navigate = useNavigate();
  const { empresaActiva, soloLectura, empresas } = useEmpresa();
  const { can } = usePermissions();
  const [params, setParams] = useSearchParams();
  const [facturas, setFacturas] = useState<FacturaPlan[]>([]);
  const [aFavor, setAFavor] = useState<Map<string, number>>(new Map());
  const [diasCaja, setDiasCaja] = useState<Record<string, number>>({});
  const [cargando, setCargando] = useState(true);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [seleccion, setSeleccion] = useState<Map<string, string>>(new Map());
  const [dialogo, setDialogo] = useState(false);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCargando(true);
      const [v, nc, dias] = await Promise.all([
        supabase.from("v_cxp_planificacion").select("*").order("vence", { ascending: true }),
        supabase.from("facturas_proveedor").select("proveedor_id, saldo_usd").eq("estado", "posted").lt("saldo_usd", -0.009),
        cargarDiasCaja(),
      ]);
      if (!vivo) return;
      setError(v.error ? v.error.message : null);
      setFacturas(((v.data ?? []) as FacturaPlan[]).map((f) => ({ ...f, saldo_usd: Number(f.saldo_usd), ret_iva_pend: Number(f.ret_iva_pend), ret_islr_pend: Number(f.ret_islr_pend) })));
      const m = new Map<string, number>();
      for (const x of (nc.data ?? []) as { proveedor_id: string | null; saldo_usd: number }[]) {
        if (x.proveedor_id) m.set(x.proveedor_id, (m.get(x.proveedor_id) ?? 0) + Math.abs(Number(x.saldo_usd)));
      }
      setAFavor(m);
      setDiasCaja(dias);
      setCargando(false);
    })();
    return () => { vivo = false; };
  }, [version]);

  // ── Fecha de corte: la de la URL o el próximo día de caja de la empresa activa ──
  const hoy = hoyCaracas();
  const diaEmpresa = empresaActiva ? diasCaja[empresaActiva.id] ?? 3 : null;
  const diasDistintos = !empresaActiva && new Set(empresas.map((e) => diasCaja[e.id] ?? 3)).size > 1;
  const diaDefecto = diaEmpresa ?? diasCaja[empresas[0]?.id ?? ""] ?? 3;
  const corteDefecto = proximoDiaCaja(diaDefecto, hoy);
  const corteUrl = params.get("corte");
  const corte = corteUrl && /^\d{4}-\d{2}-\d{2}$/.test(corteUrl) ? corteUrl : corteDefecto;
  const grupoUrl = params.get("grupo") as Grupo | null;
  const grupoSel = GRUPOS.some((g) => g.k === grupoUrl) ? grupoUrl : null;
  const setParam = (clave: string, valor: string | null) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (valor) n.set(clave, valor); else n.delete(clave);
    return n;
  }, { replace: true });

  const puedePlanificar = !soloLectura && can("planificacion_pagos", "crear");
  const filtro = q.trim().toLowerCase();
  const base = useMemo(() => facturas.filter((f) =>
    (!proveedor || f.proveedor_id === proveedor) && (!empresa || f.empresa_id === empresa)
    && (!filtro || [f.numero, f.referencia, f.proveedor_nombre, f.proveedor_rif].some((x) => (x || "").toLowerCase().includes(filtro)))),
  [facturas, proveedor, empresa, filtro]);
  const grupoFac = (f: FacturaPlan) => grupoDe(f.vence, hoy, corte);
  const totalesGrupo = GRUPOS.map((g) => {
    const fs = base.filter((f) => grupoFac(f) === g.k);
    return { ...g, n: fs.length, monto: fs.reduce((s, f) => s + f.saldo_usd, 0) };
  });
  const filas = grupoSel ? base.filter((f) => grupoFac(f) === grupoSel) : base;
  useEffect(() => { onConteo?.(filas.length, facturas.length); }, [filas.length, facturas.length, onConteo]);

  const proveedores = useMemo(() => {
    const m = new Map<string, GrupoProveedor>();
    for (const f of filas) {
      const k = f.proveedor_id ?? "—";
      const g = m.get(k) ?? { id: k, nombre: f.proveedor_nombre || "Sin proveedor", rif: f.proveedor_rif, facturas: [], saldo: 0, vencido: 0, hastaCorte: 0, ret: 0, neto: 0, aFavor: aFavor.get(k) ?? 0 };
      g.facturas.push(f); g.saldo += f.saldo_usd; g.ret += retPendiente(f); g.neto += netoSugerido(f);
      const gr = grupoDe(f.vence, hoy, corte);
      if (gr === "vencido") g.vencido += f.saldo_usd; else if (gr === "corte") g.hastaCorte += f.saldo_usd;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => (b.vencido + b.hastaCorte) - (a.vencido + a.hastaCorte) || b.saldo - a.saldo);
  }, [filas, aFavor, hoy, corte]);

  // ── Selección ──
  const elegible = (f: FacturaPlan) => !f.plan_id;
  const seleccionadas = facturas.filter((f) => seleccion.has(f.id));
  const montoDe = (f: FacturaPlan) => Number(seleccion.get(f.id) ?? 0) || 0;
  const totalSel = seleccionadas.reduce((s, f) => s + montoDe(f), 0);
  const montoInvalido = seleccionadas.some((f) => montoDe(f) <= 0 || montoDe(f) > f.saldo_usd + 0.01);
  const empresasSel = new Set(seleccionadas.map((f) => f.empresa_id));
  const alternar = (fs: FacturaPlan[], marcar: boolean) => setSeleccion((s) => {
    const n = new Map(s);
    for (const f of fs.filter(elegible)) { if (marcar) { if (!n.has(f.id)) n.set(f.id, netoSugerido(f).toFixed(2)); } else n.delete(f.id); }
    return n;
  });
  const seleccionarHastaCorte = () => alternar(base.filter((f) => ["vencido", "corte"].includes(grupoFac(f))), true);
  const todosAbiertos = proveedores.length > 0 && proveedores.every((p) => abiertos.has(p.id));
  const abrirTodos = () => setAbiertos(todosAbiertos ? new Set() : new Set(proveedores.map((p) => p.id)));
  const alternarAbierto = (id: string) => setAbiertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const abierto = (id: string) => abiertos.has(id) || !!filtro || !!proveedor;

  const exportar = () => exportarCSV(`planificacion-pagos-${corte}`, filas, [
    { titulo: "Proveedor", valor: (f) => f.proveedor_nombre ?? "" }, { titulo: "RIF", valor: (f) => f.proveedor_rif ?? "" },
    { titulo: "Factura", valor: (f) => f.numero }, { titulo: "Referencia", valor: (f) => f.referencia ?? "" },
    { titulo: "Emisión", valor: (f) => f.fecha_emision ?? "" }, { titulo: "Vence", valor: (f) => f.vence ?? "" },
    { titulo: "Días", valor: (f) => (f.vence ? diasEntre(hoy, f.vence) : "") },
    { titulo: "Grupo", valor: (f) => GRUPOS.find((g) => g.k === grupoFac(f))?.label ?? "" },
    { titulo: "Condición", valor: (f) => f.condicion_pago ?? "Sin término" }, { titulo: "Moneda", valor: (f) => f.moneda },
    { titulo: "Saldo USD", valor: (f) => Number(f.saldo_usd.toFixed(2)) },
    { titulo: "Ret. IVA pend. (est.)", valor: (f) => Number(Number(f.ret_iva_pend).toFixed(2)) },
    { titulo: "Ret. ISLR pend. (est.)", valor: (f) => Number(Number(f.ret_islr_pend).toFixed(2)) },
    { titulo: "Neto a pagar", valor: (f) => netoSugerido(f) }, { titulo: "En plan", valor: (f) => f.plan_numero ?? "" },
  ]);

  if (cargando) return <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-card px-4 py-6 text-center text-sm" data-error-carga="">
        <p className="text-destructive">No se pudieron cargar las facturas por pagar ({error}).</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setVersion((v) => v + 1)}>Reintentar</Button>
      </div>
    );
  }

  const planDestino = params.get("plan");
  return (
    <div>
      {/* Fecha de corte y atajos */}
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2" data-panel="corte">
        <CalendarClock className="h-4 w-4 text-primary" />
        <label htmlFor="corte-plan" className="text-[13px] font-medium">Pendiente al</label>
        <Input id="corte-plan" type="date" value={corte} onChange={(e) => setParam("corte", e.target.value || null)} className="h-8 w-[150px] text-[13px]" />
        <span className="text-xs text-muted-foreground">
          {corte === corteDefecto ? <>Próximo día de caja ({fmtFechaCorta(corte)})</> : (
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => setParam("corte", null)}>Volver al día de caja ({fmtFechaCorta(corteDefecto)})</button>
          )}
        </span>
        <div className="flex items-center gap-1">
          {[-7, 7].map((d) => (
            <Button key={d} variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setParam("corte", sumarDias(corte, d))}>
              {d < 0 ? "− 1 semana" : "+ 1 semana"}
            </Button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground sm:ml-auto">
          Día de caja: {empresaActiva ? DIAS_SEMANA[diaDefecto] : diasDistintos
            ? empresas.map((e) => `${e.nombre_corto} ${DIAS_SEMANA[diasCaja[e.id] ?? 3]}`).join(" · ") : DIAS_SEMANA[diaDefecto]}
          {can("configuracion", "editar") && (
            <Link to="/admin/configuracion/dias-caja" className="ml-1.5 inline-flex items-center gap-0.5 text-primary hover:underline"><Settings2 className="h-3 w-3" />cambiar</Link>
          )}
        </span>
      </div>

      <KpiStrip items={[
        ...totalesGrupo.map((g) => ({
          label: g.corto, valor: fmtUsd(g.monto), detalle: `${g.n} fact. · ${rangoGrupo(g.k, hoy, corte)}`,
          tono: g.k === "vencido" && g.monto > 0.009 ? "negativo" as const : g.k === "corte" && g.monto > 0.009 ? "alerta" as const : undefined,
          onClick: () => setParam("grupo", grupoSel === g.k ? null : g.k), activo: grupoSel === g.k, titulo: `${g.label}: ${rangoGrupo(g.k, hoy, corte)}`,
        })),
        { label: "A pagar al corte", valor: fmtUsd(totalesGrupo[0].monto + totalesGrupo[1].monto), detalle: "vencido + hasta el corte", tono: "primario" as const },
      ]} />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        {grupoSel && (
          <Badge variant="outline" className="gap-1 py-0.5">
            {GRUPOS.find((g) => g.k === grupoSel)?.label}
            <button type="button" aria-label="Quitar grupo" onClick={() => setParam("grupo", null)}><X className="h-3 w-3" /></button>
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">{proveedores.length} proveedores · {filas.length} facturas</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {puedePlanificar && (
            <Button variant="outline" size="sm" onClick={seleccionarHastaCorte} title="Marca todo lo vencido y lo que vence hasta el corte (sin las que ya están en otro plan)">
              <ListChecks className="mr-1 h-3.5 w-3.5" /> Marcar vencido + corte
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={abrirTodos}>
            {todosAbiertos ? <ChevronsDownUp className="mr-1 h-3.5 w-3.5" /> : <ChevronsUpDown className="mr-1 h-3.5 w-3.5" />}
            {todosAbiertos ? "Contraer" : "Expandir"}
          </Button>
          <BotonExportar soloIcono onClick={exportar} total={filas.length} />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table data-tabla="planificacion">
          <TableHeader>
            <TableRow>
              {puedePlanificar && <TableHead className="w-8" />}
              <TableHead>Proveedor / factura</TableHead>
              <TableHead className="hidden md:table-cell">Emisión</TableHead>
              <TableHead className="hidden sm:table-cell">Vence</TableHead>
              <TableHead className="hidden lg:table-cell">Condición</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="hidden text-right sm:table-cell" title="Retenciones IVA/ISLR aún no emitidas en Odoo (estimadas con el % histórico del proveedor)">Ret. pend.</TableHead>
              <TableHead className="hidden text-right md:table-cell">Neto</TableHead>
              {puedePlanificar && <TableHead className="text-right">A pagar</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {proveedores.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">No hay facturas por pagar con estos filtros</TableCell></TableRow>
            ) : proveedores.map((p) => {
              const elegibles = p.facturas.filter(elegible);
              const marcadas = elegibles.filter((f) => seleccion.has(f.id)).length;
              const selProv = p.facturas.reduce((s, f) => s + (seleccion.has(f.id) ? montoDe(f) : 0), 0);
              const ab = abierto(p.id);
              return (
                <Fragment key={p.id}>
                  <TableRow className="cursor-pointer bg-muted/30 hover:bg-muted/50" data-proveedor={p.id} onClick={() => alternarAbierto(p.id)}>
                    {puedePlanificar && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox aria-label={`Marcar facturas de ${p.nombre}`} disabled={!elegibles.length}
                          checked={marcadas === 0 ? false : marcadas === elegibles.length ? true : "indeterminate"}
                          onCheckedChange={(v) => alternar(p.facturas, v === true)} />
                      </TableCell>
                    )}
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-1.5">
                        {ab ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <span className="block max-w-[150px] truncate sm:max-w-[300px]" title={p.nombre}>{p.nombre}</span>
                        <span className="shrink-0 text-xs font-normal text-muted-foreground">{p.facturas.length}</span>
                        {p.aFavor > 0.009 && <Badge variant="outline" className="hidden shrink-0 px-1 py-0 text-[10px] text-success sm:inline-flex" title="Notas de crédito con saldo a favor del proveedor">a favor {fmtUsd(p.aFavor)}</Badge>}
                      </span>
                      <span className="block pl-5 text-[11px] font-normal sm:hidden">
                        {p.vencido > 0.009 ? <span className="text-destructive">{fmtUsd(p.vencido)} vencido</span> : p.hastaCorte > 0.009 ? <span className="text-warning">{fmtUsd(p.hastaCorte)} al corte</span> : <span className="text-muted-foreground">por vencer</span>}
                      </span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell" />
                    <TableCell className="hidden whitespace-nowrap text-xs sm:table-cell">
                      {p.vencido > 0.009 ? <span className="text-destructive">{fmtUsd(p.vencido)} vencido</span> : p.hastaCorte > 0.009 ? <span className="text-warning">{fmtUsd(p.hastaCorte)} al corte</span> : <span className="text-muted-foreground">por vencer</span>}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell" />
                    <TableCell className="whitespace-nowrap text-right font-semibold">{fmtUsd(p.saldo)}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-right text-muted-foreground sm:table-cell">{p.ret > 0.009 ? fmtUsd(p.ret) : "—"}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-right md:table-cell">{fmtUsd(p.neto)}</TableCell>
                    {puedePlanificar && <TableCell className="whitespace-nowrap text-right font-semibold text-primary">{selProv > 0 ? fmtUsd(selProv) : ""}</TableCell>}
                  </TableRow>
                  {ab && p.facturas.map((f) => {
                    const d = f.vence ? diasEntre(hoy, f.vence) : 0;
                    const sel = seleccion.has(f.id);
                    const monto = seleccion.get(f.id) ?? "";
                    const malo = sel && (Number(monto) <= 0 || Number(monto) > f.saldo_usd + 0.01);
                    const ret = retPendiente(f);
                    return (
                      <TableRow key={f.id} data-factura={f.id} className={cn(sel && "bg-primary/5")}>
                        {puedePlanificar && (
                          <TableCell>
                            <Checkbox aria-label={`Marcar ${f.numero}`} checked={sel} disabled={!elegible(f)} onCheckedChange={(v) => alternar([f], v === true)} />
                          </TableCell>
                        )}
                        <TableCell className="pl-3 sm:pl-7">
                          <span className="flex items-center gap-1.5 whitespace-nowrap">
                            <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => navigate(`/admin/facturas-proveedor/${f.id}`)}>{f.numero}</button>
                            {f.es_nota_debito && <Badge variant="outline" className="px-1 py-0 text-[10px]">ND</Badge>}
                            {f.referencia && <span className="hidden max-w-[140px] truncate text-xs text-muted-foreground lg:inline" title={`Ref. ${f.referencia}`}>Ref. {f.referencia}</span>}
                            {f.plan_id && (
                              <Link to={`/admin/planes-pago/${f.plan_id}`} className="shrink-0" title={`Ya está en el plan ${f.plan_numero} (${f.plan_estado}) por ${fmtUsd(Number(f.plan_monto))}`}>
                                <Badge variant="outline" className="border-primary px-1 py-0 text-[10px] text-primary">{f.plan_numero?.replace(/^.*-PP-0*/, "PP-")}</Badge>
                              </Link>
                            )}
                          </span>
                          <span className="block text-[11px] text-muted-foreground sm:hidden">{fmtFecha(f.vence)} <span className={tonoDias(d)}>{textoDias(d)}</span></span>
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{fmtFecha(f.fecha_emision)}</TableCell>
                        <TableCell className="hidden whitespace-nowrap sm:table-cell">
                          <span className="text-muted-foreground">{fmtFecha(f.vence)}</span>
                          <span className={cn("ml-1.5 text-xs", tonoDias(d))}>{textoDias(d)}</span>
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground lg:table-cell" title={f.plazo_dias != null ? `${f.plazo_dias} días desde la emisión` : undefined}>
                          {f.condicion_pago ?? <span className="italic">sin término</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">{fmtUsd(f.saldo_usd)}</TableCell>
                        <TableCell className="hidden whitespace-nowrap text-right text-xs sm:table-cell"
                          title={ret > 0 ? [Number(f.ret_iva_pend) > 0 && `IVA ${f.iva_pct ?? 75}% (est.) ${fmtUsd(Number(f.ret_iva_pend))}`, Number(f.ret_islr_pend) > 0 && `ISLR ${f.islr_pct}% (est.) ${fmtUsd(Number(f.ret_islr_pend))}`].filter(Boolean).join(" · ") : "Sin retenciones pendientes"}>
                          {ret > 0.009 ? <span className="text-warning">{fmtUsd(ret)}</span> : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-right md:table-cell">{fmtUsd(netoSugerido(f))}</TableCell>
                        {puedePlanificar && (
                          <TableCell className="py-0.5 text-right">
                            {sel ? (
                              <Input value={monto} inputMode="decimal" aria-label={`Monto a pagar de ${f.numero}`} aria-invalid={malo}
                                onChange={(e) => { const v = e.target.value.replace(",", "."); setSeleccion((s) => new Map(s).set(f.id, v)); }}
                                className={cn("ml-auto h-7 w-[84px] text-right text-[13px] tabular-nums sm:w-[96px]", malo && "border-destructive")} />
                            ) : null}
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Vencimientos y saldos según Odoo. "Ret. pend." = IVA/ISLR aún sin comprobante, estimado con el último % aplicado al proveedor (IVA 75 % si nunca se le retuvo); el neto sugerido lo descuenta.
      </p>

      {/* Barra de selección */}
      {seleccion.size > 0 && (
        <div className="sticky bottom-16 z-30 mt-2 rounded-lg border border-primary/40 bg-card/95 px-3 py-2 shadow-lg backdrop-blur lg:bottom-2" data-barra-seleccion="">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px]"><b>{seleccion.size}</b> facturas · <b className="tabular-nums text-primary">{fmtUsd(totalSel)}</b></span>
            {montoInvalido && <span className="text-xs text-destructive">Hay montos vacíos o mayores que el saldo</span>}
            {empresasSel.size > 1 && <span className="text-xs text-destructive">Un plan es de una sola empresa</span>}
            <div className="ml-auto flex items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setSeleccion(new Map())}>Limpiar</Button>
              <Button size="sm" disabled={montoInvalido || empresasSel.size > 1 || !empresaActiva} onClick={() => setDialogo(true)}>
                {planDestino ? "Agregar al plan" : "Crear plan de pago"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {dialogo && empresaActiva && (
        <DialogoCrearPlan
          abierto={dialogo} onCerrar={() => setDialogo(false)} corte={corte} empresaId={empresaActiva.id} planInicial={planDestino}
          items={seleccionadas.map((f) => ({ factura: f, monto: montoDe(f) }))}
          onCreado={(id) => { setSeleccion(new Map()); setVersion((v) => v + 1); navigate(`/admin/planes-pago/${id}`); }}
        />
      )}
    </div>
  );
}
