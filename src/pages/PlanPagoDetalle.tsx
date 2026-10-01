import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, BadgeCheck, Ban, FileDown, FileSpreadsheet, Loader2, Lock, Plus, RefreshCw, Save, Trash2, Undo2, X,
} from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { FichaCampos, Panel } from "@/components/datos/FichaCampos";
import { useToast } from "@/hooks/use-toast";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useCurrency } from "@/contexts/CurrencyContext";
import { cn } from "@/lib/utils";
import {
  ESTADO_ITEM, ESTADO_PLAN, type BancoSaldo, type ItemPlan, type PlanPago, cargarBancos, disponiblePorMoneda, fmtBs, fmtFecha, fmtUsd,
  mensajeError, nombrePersona,
} from "@/components/planificacion-pagos/comun";
import { CoberturaMonedas } from "@/components/planificacion-pagos/CoberturaMonedas";

const SELECT_PLAN = "*, creado:usuarios!planes_pago_creado_por_fkey(nombre, apellido), aprobado:usuarios!planes_pago_aprobado_por_fkey(nombre, apellido), "
  + "cerrado:usuarios!planes_pago_cerrado_por_fkey(nombre, apellido), "
  + "items:planes_pago_items(*, factura:facturas_proveedor(saldo_usd, estado_pago), banco:bancos(nombre, moneda))";

interface Edicion { monto: string; moneda: "USD" | "BS"; banco_id: string | null; notas: string }
type Accion = "aprobar" | "devolver" | "anular" | "cerrar" | "eliminar";
const ACCIONES: Record<Accion, { titulo: string; texto: string; boton: string; motivo?: boolean; peligro?: boolean }> = {
  aprobar: { titulo: "Aprobar el plan", texto: "Queda listo para que tesorería ejecute los pagos en Odoo. Ya no se puede modificar (salvo devolverlo a borrador).", boton: "Aprobar" },
  devolver: { titulo: "Devolver a borrador", texto: "El plan vuelve a borrador para corregirlo y se pierde la aprobación.", boton: "Devolver" },
  anular: { titulo: "Anular el plan", texto: "El plan queda en el historial como anulado y sus facturas vuelven a estar libres para otro plan.", boton: "Anular", motivo: true, peligro: true },
  cerrar: { titulo: "Cerrar el plan", texto: "Se marca como pagado aunque falten pagos por llegar de Odoo. Lo pendiente queda señalado en el historial.", boton: "Cerrar", motivo: true },
  eliminar: { titulo: "Eliminar el borrador", texto: "Se borra el plan y sus facturas. No se puede deshacer.", boton: "Eliminar", peligro: true },
};

const PlanPagoDetalle = () => {
  const { planId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { empresas, empresaActiva, soloLectura } = useEmpresa();
  const { can } = usePermissions();
  const { exchangeRate } = useCurrency();
  const [plan, setPlan] = useState<PlanPago | null>(null);
  const [cargando, setCargando] = useState(true);
  const [bancos, setBancos] = useState<BancoSaldo[]>([]);
  const [ediciones, setEdiciones] = useState<Record<string, Edicion>>({});
  const [quitados, setQuitados] = useState<Set<string>>(new Set());
  const [cabecera, setCabecera] = useState<{ fecha_pago: string; notas: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [motivo, setMotivo] = useState("");

  const cargar = useCallback(async () => {
    const [{ data }, b] = await Promise.all([supabase.from("planes_pago").select(SELECT_PLAN).eq("id", planId!).maybeSingle(), cargarBancos()]);
    const p = data as unknown as PlanPago | null;
    if (p?.items) p.items.sort((a, b2) => (a.proveedor_nombre ?? "").localeCompare(b2.proveedor_nombre ?? "") || (a.fecha_vencimiento ?? "").localeCompare(b2.fecha_vencimiento ?? ""));
    setPlan(p); setBancos(b); setEdiciones({}); setQuitados(new Set()); setCabecera(null); setCargando(false);
  }, [planId]);
  useEffect(() => { cargar(); }, [cargar]);

  const items = useMemo(() => (plan?.items ?? []).filter((i) => !quitados.has(i.id)), [plan, quitados]);
  const ed = (i: ItemPlan): Edicion => ediciones[i.id] ?? { monto: String(Number(i.monto_usd).toFixed(2)), moneda: i.moneda_pago, banco_id: i.banco_id, notas: i.notas ?? "" };
  const montoDe = (i: ItemPlan) => Number(ed(i).monto) || 0;
  const editar = (i: ItemPlan, cambio: Partial<Edicion>) => setEdiciones((e) => ({ ...e, [i.id]: { ...ed(i), ...cambio } }));
  const sucio = Object.keys(ediciones).length > 0 || quitados.size > 0 || !!cabecera;

  if (cargando) return <MainLayout title="Plan de pago"><div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div></MainLayout>;
  if (!plan) {
    return (
      <MainLayout title="Plan de pago">
        <div className="py-10 text-center text-muted-foreground">
          Plan no encontrado (o pertenece a la otra empresa). <Link className="text-primary hover:underline" to="/admin/cuentas-por-pagar?tab=planes">Ver planes</Link>
        </div>
      </MainLayout>
    );
  }

  const empresa = empresas.find((e) => e.id === plan.empresa_id) ?? null;
  const enEmpresa = !soloLectura && empresaActiva?.id === plan.empresa_id;
  const borrador = plan.estado === "borrador";
  const aprobado = plan.estado === "aprobado";
  const editable = borrador && enEmpresa && can("planificacion_pagos", "editar");
  const aprobador = enEmpresa && can("aprobacion_pagos", "editar");
  const tasa = Number(plan.tasa_bcv) > 0 && !borrador ? Number(plan.tasa_bcv) : exchangeRate;
  const bancosEmpresa = bancos.filter((b) => b.empresa_id === plan.empresa_id);
  const nombreBanco = Object.fromEntries(bancos.map((b) => [b.id, b.nombre]));
  const disp = disponiblePorMoneda(bancos, plan.empresa_id);

  const total = items.reduce((s, i) => s + montoDe(i), 0);
  const totUsd = items.filter((i) => ed(i).moneda === "USD").reduce((s, i) => s + montoDe(i), 0);
  const totBsUsd = total - totUsd;
  const pagado = items.reduce((s, i) => s + Number(i.monto_pagado_usd), 0);
  const cerrados = items.filter((i) => i.estado === "pagado" || i.estado === "diferencia").length;
  const diferencias = items.filter((i) => i.estado === "diferencia").length;
  const invalidos = items.filter((i) => montoDe(i) <= 0 || (i.factura && montoDe(i) > Number(i.factura.saldo_usd) + 0.01));

  const grupos = (() => {
    const m = new Map<string, { nombre: string; items: ItemPlan[] }>();
    for (const i of items) {
      const k = i.proveedor_id ?? i.proveedor_nombre ?? "—";
      if (!m.has(k)) m.set(k, { nombre: i.proveedor_nombre || "Sin proveedor", items: [] });
      m.get(k)!.items.push(i);
    }
    return [...m.entries()];
  })();

  const guardar = async () => {
    const sinFactura = items.filter((i) => !i.factura_proveedor_id);
    setOcupado("guardar");
    const { error } = await supabase.rpc("guardar_plan_pago", {
      p_plan_id: plan.id, p_fecha_corte: null, p_fecha_pago: cabecera?.fecha_pago ?? null, p_notas: cabecera ? cabecera.notas : null,
      p_items: items.filter((i) => i.factura_proveedor_id).map((i) => {
        const e = ed(i);
        return { factura_proveedor_id: i.factura_proveedor_id, monto_usd: Math.round(montoDe(i) * 100) / 100, moneda_pago: e.moneda, banco_id: e.banco_id, notas: e.notas };
      }),
      p_modo: "reemplazar",
    });
    setOcupado(null);
    if (error) { toast({ title: "No se pudo guardar", description: mensajeError(error), variant: "destructive" }); return; }
    toast({ title: "Plan guardado", description: sinFactura.length ? `${sinFactura.length} factura(s) que ya no están en Odoo se quitaron` : undefined });
    cargar();
  };
  const ejecutar = async (a: Accion) => {
    setOcupado(a);
    const { error } = a === "eliminar"
      ? await supabase.rpc("eliminar_plan_pago", { p_plan_id: plan.id })
      : await supabase.rpc("cambiar_estado_plan_pago", { p_plan_id: plan.id, p_accion: a, p_motivo: motivo || null });
    setOcupado(null); setAccion(null); setMotivo("");
    if (error) { toast({ title: "No se pudo completar", description: mensajeError(error), variant: "destructive" }); return; }
    if (a === "eliminar") { toast({ title: "Borrador eliminado" }); navigate("/admin/cuentas-por-pagar?tab=planes"); return; }
    toast({ title: { aprobar: "Plan aprobado", devolver: "Plan devuelto a borrador", anular: "Plan anulado", cerrar: "Plan cerrado" }[a] });
    cargar();
  };
  const revisar = async () => {
    setOcupado("revisar");
    const { data, error } = await supabase.rpc("conciliar_planes_pago", { p_empresa: null, p_plan: plan.id });
    setOcupado(null);
    if (error) { toast({ title: "No se pudo revisar", description: mensajeError(error), variant: "destructive" }); return; }
    const r = data as { planes_cerrados?: number } | null;
    toast({ title: r?.planes_cerrados ? "Todos los pagos llegaron: plan cerrado" : "Pagos revisados contra Odoo" });
    cargar();
  };
  const datosExport = () => ({
    plan, items: items.map((i) => ({ ...i, monto_usd: montoDe(i), moneda_pago: ed(i).moneda, banco_id: ed(i).banco_id, notas: ed(i).notas || null })),
    empresa: empresa ? { nombre: empresa.nombre, rif: empresa.rif, color: empresa.color } : null, bancos: nombreBanco, tasa,
    cobertura: { usd: { plan: totUsd, disp: disp.usd }, bs: { plan: totBsUsd * tasa, disp: disp.bs, planUsd: totBsUsd } },
  });
  const exportar = async (tipo: "pdf" | "xlsx") => {
    setOcupado(tipo);
    try {
      const m = await import("@/components/planificacion-pagos/exportarPlan");
      await (tipo === "pdf" ? m.descargarPdfPlan(datosExport()) : m.descargarExcelPlan(datosExport()));
    } catch (e) {
      toast({ title: "No se pudo generar el archivo", description: mensajeError(e), variant: "destructive" });
    }
    setOcupado(null);
  };

  const e = ESTADO_PLAN[plan.estado];
  const btn = (a: Accion, icono: ReactNode, variante: "default" | "outline" | "ghost" | "destructive" = "outline") => (
    <Button size="sm" variant={variante} onClick={() => setAccion(a)} disabled={!!ocupado || (a === "aprobar" && (sucio || invalidos.length > 0))}>
      {ocupado === a ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : icono}{ACCIONES[a].boton}
    </Button>
  );

  return (
    <MainLayout title={`Plan de pago ${plan.numero}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/cuentas-por-pagar?tab=planes")}><ArrowLeft className="mr-1 h-4 w-4" />Planes</Button>
        <h1 className="font-mono text-base font-semibold">{plan.numero}</h1>
        <Badge variant={e.variant} className={e.clase}>{e.label}</Badge>
        {plan.cierre && <span className="text-xs text-muted-foreground">cierre {plan.cierre === "automatico" ? "automático (sincronización)" : "manual"}</span>}
        {empresa && <span className="text-xs text-muted-foreground">{empresa.nombre_corto}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5" data-acciones="">
          {editable && <Button size="sm" onClick={guardar} disabled={!sucio || !!ocupado || invalidos.length > 0}>{ocupado === "guardar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}Guardar</Button>}
          {editable && <Button size="sm" variant="outline" onClick={() => navigate(`/admin/cuentas-por-pagar?tab=planificacion&plan=${plan.id}&corte=${plan.fecha_corte}`)}><Plus className="mr-1 h-3.5 w-3.5" />Agregar facturas</Button>}
          {borrador && aprobador && btn("aprobar", <BadgeCheck className="mr-1 h-3.5 w-3.5" />, "default")}
          {aprobado && (
            <Button size="sm" variant="outline" onClick={revisar} disabled={!!ocupado} title="Busca en lo sincronizado de Odoo los pagos de las facturas del plan">
              {ocupado === "revisar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}Revisar pagos
            </Button>
          )}
          {aprobado && aprobador && btn("cerrar", <Lock className="mr-1 h-3.5 w-3.5" />)}
          {aprobado && aprobador && btn("devolver", <Undo2 className="mr-1 h-3.5 w-3.5" />, "ghost")}
          {aprobado && aprobador && btn("anular", <Ban className="mr-1 h-3.5 w-3.5" />, "ghost")}
          {borrador && enEmpresa && can("planificacion_pagos", "eliminar") && btn("eliminar", <Trash2 className="mr-1 h-3.5 w-3.5" />, "ghost")}
          <Button size="sm" variant="outline" onClick={() => exportar("pdf")} disabled={!!ocupado}>{ocupado === "pdf" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileDown className="mr-1 h-3.5 w-3.5" />}PDF</Button>
          <Button size="sm" variant="outline" onClick={() => exportar("xlsx")} disabled={!!ocupado}>{ocupado === "xlsx" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="mr-1 h-3.5 w-3.5" />}Excel</Button>
        </div>
      </div>
      {borrador && !aprobador && enEmpresa && <p className="mb-2 text-xs text-muted-foreground">Un usuario con permiso de <b>Aprobación de pagos</b> debe aprobar este plan.</p>}
      {soloLectura && <p className="mb-2 text-xs text-muted-foreground">Modo consulta («Ambas empresas»): elige {empresa?.nombre_corto ?? "la empresa"} en el menú superior para modificar el plan.</p>}

      <KpiStrip items={[
        { label: "Planificado", valor: fmtUsd(total), detalle: `${items.length} facturas · ${grupos.length} proveedores`, tono: "primario" },
        { label: "Pagado (Odoo)", valor: fmtUsd(pagado), tono: pagado > 0.009 ? "positivo" : "tenue", detalle: plan.conciliado_at ? `revisado ${new Date(plan.conciliado_at).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" })}` : undefined },
        { label: "Por pagar", valor: fmtUsd(Math.max(0, total - pagado)), tono: total - pagado > 0.009 && plan.estado !== "anulado" ? "alerta" : "tenue" },
        { label: "Facturas cerradas", valor: `${cerrados} / ${items.length}`, tono: cerrados === items.length && items.length ? "positivo" : "normal" },
        { label: "Diferencias", valor: diferencias, tono: diferencias ? "negativo" : "tenue", titulo: "Pagado distinto a lo planificado, o factura saldada sin pago" },
      ]} />

      <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
        <Panel titulo="Datos del plan">
          <FichaCampos columnas={3} campos={[
            { label: "Fecha de pago", valor: editable
              ? <Input type="date" className="h-8 w-[150px]" value={cabecera?.fecha_pago ?? plan.fecha_pago} onChange={(ev) => setCabecera({ fecha_pago: ev.target.value, notas: cabecera?.notas ?? plan.notas ?? "" })} />
              : fmtFecha(plan.fecha_pago) },
            { label: "Pendiente al (corte)", valor: fmtFecha(plan.fecha_corte) },
            { label: "Tasa BCV", valor: tasa ? tasa.toLocaleString("es-VE") : "—" },
            { label: "Creado", valor: `${nombrePersona(plan.creado)} · ${fmtFecha(plan.created_at)}` },
            { label: "Aprobado", valor: plan.aprobado_at ? `${nombrePersona(plan.aprobado)} · ${fmtFecha(plan.aprobado_at)}` : "—" },
            { label: plan.estado === "anulado" ? "Anulado" : "Cerrado", valor: plan.cerrado_at ? `${plan.cerrado ? nombrePersona(plan.cerrado) : "Sincronización"} · ${fmtFecha(plan.cerrado_at)}` : "—" },
            { label: "Notas", ancho: 3, valor: editable
              ? <Textarea rows={2} value={cabecera?.notas ?? plan.notas ?? ""} onChange={(ev) => setCabecera({ fecha_pago: cabecera?.fecha_pago ?? plan.fecha_pago, notas: ev.target.value })} />
              : <span className="whitespace-pre-line">{[plan.notas, plan.anulado_motivo && `Motivo de anulación: ${plan.anulado_motivo}`].filter(Boolean).join("\n") || "—"}</span> },
          ]} />
        </Panel>
        <Panel titulo="Total contra bancos" acciones={<Link to="/admin/bancos" className="text-xs text-primary hover:underline">Bancos</Link>}>
          <CoberturaMonedas planUsd={totUsd} planBsUsd={totBsUsd} tasa={tasa} dispUsd={disp.usd} dispBs={disp.bs} />
          <p className="mt-1.5 text-[11px] text-muted-foreground">Saldos de los bancos de {empresa?.nombre_corto ?? "la empresa"} según Odoo. Lo que se paga en Bs. se convierte a la tasa {borrador ? "BCV de hoy" : "del plan"}.</p>
        </Panel>
      </div>

      <Panel titulo={`Facturas (${items.length})`} sinPadding acciones={invalidos.length > 0 ? <span className="text-xs text-destructive">{invalidos.length} con monto inválido o mayor que el saldo</span> : undefined}>
        <Table data-tabla="items-plan">
          <TableHeader>
            <TableRow>
              <TableHead>Factura</TableHead>
              <TableHead className="hidden md:table-cell">Vence</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Saldo</TableHead>
              <TableHead className="hidden text-right lg:table-cell" title="Retenciones pendientes estimadas al planificar">Ret. pend.</TableHead>
              <TableHead className="text-right">A pagar</TableHead>
              <TableHead>Moneda / banco</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="hidden text-right md:table-cell">Pagado</TableHead>
              {editable && <TableHead className="w-8" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {grupos.map(([k, g]) => {
              const sub = g.items.reduce((s, i) => s + montoDe(i), 0);
              return (
                <Fragment key={k}>
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={4} className="font-medium"><span className="block max-w-[220px] truncate sm:max-w-none" title={g.nombre}>{g.nombre}</span></TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold">{fmtUsd(sub)}</TableCell>
                    <TableCell colSpan={editable ? 4 : 3} />
                  </TableRow>
                  {g.items.map((i) => {
                    const e2 = ed(i);
                    const saldoAct = i.factura ? Number(i.factura.saldo_usd) : null;
                    const malo = montoDe(i) <= 0 || (saldoAct != null && montoDe(i) > saldoAct + 0.01);
                    const est = ESTADO_ITEM[i.estado];
                    return (
                      <TableRow key={i.id} data-item={i.id}>
                        <TableCell className="whitespace-nowrap">
                          {i.factura_proveedor_id
                            ? <Link to={`/admin/facturas-proveedor/${i.factura_proveedor_id}`} className="font-mono text-xs text-primary hover:underline">{i.factura_numero}</Link>
                            : <span className="font-mono text-xs text-muted-foreground line-through" title="Ya no está en Odoo">{i.factura_numero}</span>}
                          {i.factura_referencia && <span className="ml-1.5 hidden text-xs text-muted-foreground lg:inline">Ref. {i.factura_referencia}</span>}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{fmtFecha(i.fecha_vencimiento)}</TableCell>
                        <TableCell className="hidden whitespace-nowrap text-right sm:table-cell"
                          title={saldoAct != null && Math.abs(saldoAct - Number(i.saldo_al_planificar)) > 0.009 ? `Al planificar: ${fmtUsd(Number(i.saldo_al_planificar))}` : undefined}>
                          {saldoAct == null ? "—" : <span className={cn(Math.abs(saldoAct - Number(i.saldo_al_planificar)) > 0.009 && "text-warning")}>{fmtUsd(saldoAct)}</span>}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-right text-xs text-muted-foreground lg:table-cell">{Number(i.ret_pendiente_est) > 0.009 ? fmtUsd(Number(i.ret_pendiente_est)) : "—"}</TableCell>
                        <TableCell className="whitespace-nowrap py-0.5 text-right font-semibold">
                          {editable ? (
                            <Input value={e2.monto} inputMode="decimal" aria-label={`Monto de ${i.factura_numero}`} aria-invalid={malo}
                              onChange={(ev) => editar(i, { monto: ev.target.value.replace(",", ".") })}
                              className={cn("ml-auto h-7 w-[96px] text-right text-[13px] tabular-nums", malo && "border-destructive")} />
                          ) : fmtUsd(Number(i.monto_usd))}
                          {e2.moneda === "BS" && tasa > 0 && <div className="text-[11px] font-normal text-muted-foreground">{fmtBs(montoDe(i) * tasa)}</div>}
                        </TableCell>
                        <TableCell className="py-0.5">
                          {editable ? (
                            <select aria-label={`Banco de ${i.factura_numero}`} value={e2.banco_id ?? `moneda:${e2.moneda}`}
                              onChange={(ev) => {
                                const v = ev.target.value;
                                if (v.startsWith("moneda:")) editar(i, { banco_id: null, moneda: v.slice(7) as "USD" | "BS" });
                                else editar(i, { banco_id: v, moneda: bancosEmpresa.find((b) => b.id === v)?.moneda === "USD" ? "USD" : "BS" });
                              }}
                              className="h-7 max-w-[170px] rounded-md border border-input bg-background px-1.5 text-xs">
                              <option value="moneda:USD">USD (sin banco)</option>
                              <option value="moneda:BS">Bs. (sin banco)</option>
                              {bancosEmpresa.map((b) => <option key={b.id} value={b.id}>{b.nombre} ({b.moneda === "USD" ? "USD" : "Bs."})</option>)}
                            </select>
                          ) : (
                            <span className="whitespace-nowrap text-xs">{e2.moneda === "BS" ? "Bs." : "USD"}{e2.banco_id ? ` · ${nombreBanco[e2.banco_id] ?? i.banco?.nombre ?? ""}` : ""}</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className={cn("text-xs font-medium", est.clase)} title={i.motivo_diferencia ?? undefined}>{est.label}</span>
                          {i.motivo_diferencia && <div className="max-w-[220px] truncate text-[11px] text-muted-foreground" title={i.motivo_diferencia}>{i.motivo_diferencia}</div>}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap text-right md:table-cell" title={i.pagos_odoo ? `Pagos en Odoo: ${i.pagos_odoo}${i.fecha_pago_real ? ` · ${fmtFecha(i.fecha_pago_real)}` : ""}` : undefined}>
                          {Number(i.monto_pagado_usd) > 0.009 ? (
                            <>
                              <span className="text-success">{fmtUsd(Number(i.monto_pagado_usd))}</span>
                              {i.diferencia_usd != null && Math.abs(Number(i.diferencia_usd)) > 0.009 && <div className={cn("text-[11px]", i.estado === "diferencia" ? "text-destructive" : "text-muted-foreground")}>{Number(i.diferencia_usd) > 0 ? "+" : ""}{fmtUsd(Number(i.diferencia_usd))}</div>}
                            </>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        {editable && (
                          <TableCell className="py-0.5">
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Quitar ${i.factura_numero}`} onClick={() => setQuitados((s) => new Set(s).add(i.id))}><X className="h-3.5 w-3.5" /></Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </Fragment>
              );
            })}
            {items.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">El plan no tiene facturas{quitados.size ? " (guarda para confirmar o recarga para deshacer)" : ""}</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Panel>

      <AlertDialog open={!!accion} onOpenChange={(v) => { if (!v) { setAccion(null); setMotivo(""); } }}>
        <AlertDialogContent>
          {accion && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{ACCIONES[accion].titulo} {plan.numero}</AlertDialogTitle>
                <AlertDialogDescription>{ACCIONES[accion].texto}</AlertDialogDescription>
              </AlertDialogHeader>
              {ACCIONES[accion].motivo && <Textarea rows={2} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="Motivo (opcional)" />}
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction className={cn(ACCIONES[accion].peligro && "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
                  onClick={(ev) => { ev.preventDefault(); ejecutar(accion); }} disabled={!!ocupado}>
                  {ocupado === accion && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}{ACCIONES[accion].boton}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
};

export default PlanPagoDetalle;
