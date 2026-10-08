import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { FichaCampos, Panel } from "@/components/datos/FichaCampos";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { useColumnas } from "@/components/datos/columnas";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesPrueba, pasaPrueba, coincide, enRango, contadorFiltrado, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";
import { tipoDe, fechaHora, fechaCorta, motivoNoRestaurable, type ItemPapelera } from "@/components/papelera/tipos";

// Papelera general (fase 22a): todo lo anulado o archivado, con la foto completa de lo que era, quién, cuándo y por qué.
// Restaurar (solo administradores) lo hace la base con restaurar_papelera según el tipo.

const restaurado = (i: ItemPapelera) => !!i.restaurado_at;
const ACCION: Record<string, string> = { anulado: "Anulado", archivado: "Archivado" };

const Papelera = () => {
  const { formatPrice } = useCurrency();
  const { empresas, soloLectura } = useEmpresa();
  const { can } = usePermissions();
  const { toast } = useToast();
  const [items, setItems] = useState<ItemPapelera[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<ItemPapelera | null>(null);
  const [aRestaurar, setARestaurar] = useState<ItemPapelera | null>(null);
  const [restaurando, setRestaurando] = useState(false);
  const puedeRestaurar = can("papelera", "editar");

  const cargar = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("papelera")
      .select("id, tipo, accion, registro_id, numero, empresa_id, cliente_id, monto_usd, titulo, resumen, datos, motivo, restaurable, eliminado_por, eliminado_por_nombre, eliminado_at, restaurado_por, restaurado_por_nombre, restaurado_at, cliente:clientes(nombre_negocio)")
      .order("eliminado_at", { ascending: false })
      .limit(10000);
    if (error) toast({ title: "No se pudo cargar la papelera", description: error.message, variant: "destructive" });
    setItems((data as unknown as ItemPapelera[]) ?? []);
    setLoading(false);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, []);

  const quien = (i: ItemPapelera) => i.eliminado_por_nombre ?? "Sistema";
  const clienteDe = (i: ItemPapelera) => i.cliente?.nombre_negocio ?? null;
  const empresaDe = (id: string | null) => (id ? empresas.find((e) => e.id === id)?.nombre_corto ?? "—" : "Compartido");

  // ---- Filtros (en la URL) ----
  const pruebasEstado: OpcionPrueba<ItemPapelera>[] = [
    { valor: "papelera", etiqueta: "En la papelera", prueba: (i) => !restaurado(i) },
    { valor: "restaurados", etiqueta: "Restaurados", prueba: restaurado },
    { valor: "restaurables", etiqueta: "Se pueden restaurar", prueba: (i) => !restaurado(i) && i.restaurable },
    { valor: "todos", etiqueta: "Todos", prueba: () => true },
  ];
  const filtroEmpresa = useFiltroEmpresa(items);
  const f = useFiltros([
    { clave: "estado", etiqueta: "Estado", principal: true, porDefecto: "papelera", opciones: opcionesPrueba(items, pruebasEstado) },
    { clave: "tipo", etiqueta: "Tipo", todos: "Todos los tipos", principal: true, opciones: opcionesDe(items, (i) => i.tipo, (_i, v) => tipoDe(v).plural) },
    { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", principal: true },
    { clave: "quien", etiqueta: "Quién", todos: "Todos", opciones: opcionesDe(items, (i) => i.eliminado_por_nombre, undefined, "Sistema") },
    { clave: "cliente", etiqueta: "Cliente", todos: "Todos los clientes", opciones: opcionesDe(items, (i) => i.cliente_id, (i) => clienteDe(i) ?? "—", "Sin cliente") },
    filtroEmpresa,
  ]);
  const texto = q.trim().toLowerCase();
  const pasa = (i: ItemPapelera) => coincide(i.tipo, f.v("tipo")) && enRango(i.eliminado_at, f.v("fecha"))
    && coincide(i.eliminado_por_nombre, f.v("quien")) && coincide(i.cliente_id, f.v("cliente"))
    && (!filtroEmpresa || coincide(i.empresa_id, f.v("empresa")));
  const filtrados = useMemo(() => items.filter((i) => pasaPrueba(pruebasEstado, f.v("estado"), i) && pasa(i)
    && (!texto || [i.numero, i.titulo, i.resumen, clienteDe(i), i.motivo, quien(i)].some((v) => (v || "").toLowerCase().includes(texto)))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, f.firma, texto]);
  const { ordenadas, orden, alternar } = useOrdenTabla(filtrados, {
    fecha: (i) => i.eliminado_at, tipo: (i) => tipoDe(i.tipo).etiqueta, numero: (i) => i.numero ?? i.titulo, cliente: (i) => clienteDe(i),
    monto: (i) => Number(i.monto_usd ?? 0), quien: (i) => quien(i),
  });
  const pg = usePagination(ordenadas, 50, f.firma);
  const exportar = () => exportarCSV("papelera", ordenadas, [
    { titulo: "Fecha", valor: (i) => i.eliminado_at?.slice(0, 19).replace("T", " ") }, { titulo: "Tipo", valor: (i) => tipoDe(i.tipo).etiqueta },
    { titulo: "Acción", valor: (i) => ACCION[i.accion] ?? i.accion }, { titulo: "Documento", valor: (i) => i.numero ?? i.titulo },
    { titulo: "Cliente", valor: (i) => clienteDe(i) }, { titulo: "Monto USD", valor: (i) => (i.monto_usd == null ? null : Number(i.monto_usd)) },
    { titulo: "Detalle", valor: (i) => i.resumen }, { titulo: "Motivo", valor: (i) => i.motivo }, { titulo: "Por", valor: (i) => quien(i) },
    { titulo: "Empresa", valor: (i) => empresaDe(i.empresa_id) },
    { titulo: "Restaurado", valor: (i) => (i.restaurado_at ? `${i.restaurado_at.slice(0, 10)} · ${i.restaurado_por_nombre ?? ""}` : "") },
  ]);

  // Indicadores sobre lo que sigue en la papelera (con los filtros de tipo/fecha/empresa, sin la búsqueda)
  const base = items.filter((i) => !restaurado(i) && pasa(i));
  const cobros = base.filter((i) => i.tipo === "cobro");
  const cuentas = base.filter((i) => i.tipo === "cuenta_manual");
  const nRestaurados = items.filter((i) => restaurado(i) && pasa(i)).length;
  const verEstado = (v: string, tipo = "") => f.setVarios({ estado: v, tipo });

  const restaurar = async () => {
    if (!aRestaurar) return;
    setRestaurando(true);
    const { error } = await supabase.rpc("restaurar_papelera", { p_id: aRestaurar.id });
    setRestaurando(false);
    if (error) { toast({ title: "No se pudo restaurar", description: error.message, variant: "destructive" }); return; }
    toast({ title: `${aRestaurar.titulo} restaurado`, description: "Volvió a su lugar. La papelera conserva el registro de lo que pasó." });
    setARestaurar(null);
    setSel(null);
    cargar();
  };

  const estadoBadge = (i: ItemPapelera) => restaurado(i)
    ? <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">Restaurado</Badge>
    : <Badge variant="outline" className="text-muted-foreground">{ACCION[i.accion] ?? i.accion}</Badge>;
  const botonRestaurar = (i: ItemPapelera, grande = false) => {
    if (!puedeRestaurar || restaurado(i) || !i.restaurable) return null;
    const titulo = soloLectura ? "Elige GUDS o Quirutec en el menú superior para restaurar" : `Restaurar ${i.titulo}`;
    return grande ? (
      <Button size="sm" className="gap-1.5" disabled={soloLectura} title={titulo} onClick={() => setARestaurar(i)}>
        <RotateCcw className="h-3.5 w-3.5" /> Restaurar
      </Button>
    ) : (
      <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={soloLectura} title={titulo} aria-label={titulo}
        onClick={(e) => { e.stopPropagation(); setARestaurar(i); }}>
        <RotateCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Restaurar</span>
      </Button>
    );
  };

  const cols = useColumnas("papelera", [
    { etiqueta: "Fecha" }, { etiqueta: "Tipo" }, { etiqueta: "Documento", fija: true }, { etiqueta: "Cliente" }, { etiqueta: "Monto" },
    { etiqueta: "Motivo" }, { etiqueta: "Por" }, ...(soloLectura ? [{ etiqueta: "Empresa" }] : []), { etiqueta: "Estado" }, { etiqueta: "Acciones", fija: true },
  ]);
  const nCols = soloLectura ? 10 : 9;
  const tipoSel = sel ? tipoDe(sel.tipo) : null;
  const enlaceSel = sel && tipoSel?.enlace ? tipoSel.enlace(sel) : null;

  return (
    <MainLayout title="Papelera">
      {cols.estilo}
      <KpiStrip items={[
        { label: "En la papelera", valor: base.length, tono: "primario", onClick: () => verEstado(""), activo: f.v("estado") === "papelera" && !f.v("tipo"), titulo: "Ver todo lo que sigue en la papelera" },
        { label: "Cobros anulados", valor: cobros.length, detalle: cobros.length ? formatPrice(cobros.reduce((s, i) => s + Number(i.monto_usd ?? 0), 0)) : undefined,
          tono: cobros.length ? "alerta" : "normal", onClick: () => verEstado("", "cobro"), activo: f.v("estado") === "papelera" && f.v("tipo") === "cobro" },
        { label: "Cuentas manuales archivadas", valor: cuentas.length, detalle: cuentas.length ? formatPrice(cuentas.reduce((s, i) => s + Number(i.monto_usd ?? 0), 0)) : undefined,
          tono: "tenue", onClick: () => verEstado("", "cuenta_manual"), activo: f.v("estado") === "papelera" && f.v("tipo") === "cuenta_manual" },
        { label: "Restaurados", valor: nRestaurados, tono: nRestaurados ? "positivo" : "normal", onClick: () => verEstado("restaurados"), activo: f.v("estado") === "restaurados" },
      ]} />

      <BarraLista
        busqueda={q}
        onBusqueda={setQ}
        placeholder="Buscar número, cliente, motivo o quién..."
        filtros={<FiltrosLista filtros={f} resultados={filtrados.length} />}
        contador={loading ? undefined : contadorFiltrado(filtrados.length, items.length, f.activos || !!texto)}
        acciones={<>{cols.selector}<BotonExportar onClick={exportar} total={ordenadas.length} /></>}
      />

      <div className="rounded-lg border border-border bg-card">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <>
            <Table data-tabla="papelera">
              <TableHeader>
                <TableRow>
                  <EncabezadoOrdenable clave="fecha" orden={orden} onOrdenar={alternar}>Fecha</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="tipo" orden={orden} onOrdenar={alternar}>Tipo</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="numero" orden={orden} onOrdenar={alternar}>Documento</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="cliente" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable>
                  <EncabezadoOrdenable clave="monto" orden={orden} onOrdenar={alternar} alinear="derecha">Monto</EncabezadoOrdenable>
                  <TableHead>Motivo</TableHead>
                  <EncabezadoOrdenable clave="quien" orden={orden} onOrdenar={alternar}>Por</EncabezadoOrdenable>
                  {soloLectura && <TableHead>Empresa</TableHead>}
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pg.pageItems.length === 0 ? (
                  <TableRow><TableCell colSpan={nCols} className="py-10 text-center text-muted-foreground">
                    <Trash2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
                    {items.length > 0 ? "Nada coincide con la búsqueda o los filtros." : "La papelera está vacía. Lo que se anule o archive aparecerá aquí."}
                    {f.activos > 0 && <button type="button" className="ml-2 text-xs font-medium text-primary hover:underline" onClick={f.limpiar}>Limpiar filtros</button>}
                  </TableCell></TableRow>
                ) : pg.pageItems.map((i) => {
                  const t = tipoDe(i.tipo);
                  return (
                    <TableRow key={i.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSel(i)} data-papelera={i.tipo}>
                      <TableCell className="whitespace-nowrap text-muted-foreground"><span title={fechaHora(i.eliminado_at) ?? undefined}>{fechaCorta(i.eliminado_at)}</span></TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5"><t.icono className="h-3.5 w-3.5 text-muted-foreground" />{t.etiqueta}</span>
                      </TableCell>
                      <TableCell>
                        <span className="block whitespace-nowrap font-mono text-xs text-primary">{i.numero ?? i.titulo}</span>
                        {i.resumen && <span className="block max-w-[210px] truncate text-[11px] text-muted-foreground" title={i.resumen}>{i.resumen}</span>}
                      </TableCell>
                      <TableCell><span className="block max-w-[170px] truncate" title={clienteDe(i) ?? undefined}>{clienteDe(i) ?? "—"}</span></TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold">{i.monto_usd == null ? "—" : formatPrice(Number(i.monto_usd))}</TableCell>
                      <TableCell className="text-muted-foreground"><span className="block max-w-[170px] truncate" title={i.motivo ?? undefined}>{i.motivo ?? "—"}</span></TableCell>
                      <TableCell className="whitespace-nowrap">{quien(i)}</TableCell>
                      {soloLectura && <TableCell className="whitespace-nowrap text-muted-foreground">{empresaDe(i.empresa_id)}</TableCell>}
                      <TableCell className="whitespace-nowrap">{estadoBadge(i)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Ver detalle" aria-label={`Ver detalle de ${i.titulo}`}
                            onClick={(e) => { e.stopPropagation(); setSel(i); }}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {botonRestaurar(i)}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pg} />
          </>
        )}
      </div>

      {/* Detalle */}
      <Sheet open={!!sel} onOpenChange={(o) => { if (!o) setSel(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {sel && tipoSel && (
            <div className="space-y-3">
              <SheetHeader>
                <SheetTitle className="flex flex-wrap items-center gap-2 pr-6">
                  <tipoSel.icono className="h-4 w-4 text-muted-foreground" /> {sel.titulo} {estadoBadge(sel)}
                </SheetTitle>
                <SheetDescription>{sel.resumen ?? tipoSel.etiqueta}</SheetDescription>
              </SheetHeader>
              <Panel titulo="En la papelera">
                <FichaCampos columnas={3} campos={[
                  { label: "Tipo", valor: tipoSel.etiqueta },
                  { label: "Acción", valor: ACCION[sel.accion] ?? sel.accion },
                  { label: "Empresa", valor: empresaDe(sel.empresa_id) },
                  { label: "Cliente", valor: clienteDe(sel), ancho: 2 },
                  { label: "Monto", valor: sel.monto_usd == null ? null : formatPrice(Number(sel.monto_usd)) },
                  { label: ACCION[sel.accion] === "Archivado" ? "Archivado" : "Anulado", valor: fechaHora(sel.eliminado_at) },
                  { label: "Por", valor: quien(sel) },
                  { label: "Restaurado", valor: sel.restaurado_at ? `${fechaHora(sel.restaurado_at)} · ${sel.restaurado_por_nombre ?? "—"}` : null },
                  { label: "Motivo", valor: sel.motivo, ancho: 3 },
                ]} />
                {!sel.restaurable && !restaurado(sel) && <p className="mt-2 text-xs text-muted-foreground">{motivoNoRestaurable(sel)}</p>}
              </Panel>
              {tipoSel.Detalle && <tipoSel.Detalle item={sel} />}
              <details className="rounded-lg border border-border bg-card">
                <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold">Datos completos guardados</summary>
                <pre className="max-h-80 overflow-auto border-t border-border bg-muted/30 p-3 text-[11px] leading-snug">{JSON.stringify(sel.datos ?? {}, null, 2)}</pre>
              </details>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                {enlaceSel ? <Link to={enlaceSel.ruta} className="text-sm font-medium text-primary hover:underline">{enlaceSel.texto}</Link> : <span />}
                {botonRestaurar(sel, true)}
              </div>
              {soloLectura && puedeRestaurar && sel.restaurable && !restaurado(sel) && (
                <p className="text-xs text-muted-foreground">Estás viendo «Ambas empresas» (solo consulta): elige GUDS o Quirutec en el menú superior para restaurar.</p>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Confirmar restauración */}
      <AlertDialog open={!!aRestaurar} onOpenChange={(o) => { if (!o && !restaurando) setARestaurar(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Restaurar {aRestaurar?.titulo}?</AlertDialogTitle>
            <AlertDialogDescription>
              {aRestaurar ? (tipoDe(aRestaurar.tipo).restaurarTexto?.(aRestaurar) ?? "Vuelve a como estaba antes de anularlo.") : ""}
              {" "}La papelera conserva el registro de la anulación y de la restauración.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restaurando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); restaurar(); }} disabled={restaurando} className="gap-2">
              {restaurando && <Loader2 className="h-4 w-4 animate-spin" />} Restaurar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MainLayout>
  );
};

export default Papelera;
