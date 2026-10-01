import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Copy, Download, Edit, FileUp, Loader2, Percent, RotateCcw, Save, Tags, X } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { OdooBadge } from "@/components/OdooBadge";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionsContext";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { fmtUsd } from "@/components/estado-cuenta/formato";
import { cn } from "@/lib/utils";
import {
  difPct, esDeGuds, leerPrecio, normalizar, redondear, textoPrecio, type ListaPrecio, type OrigenCambio, type ProductoLista,
} from "@/components/listas-precios/comun";
import { AjusteMasivoDialog } from "@/components/listas-precios/AjusteMasivoDialog";
import { ImportarPreciosDialog } from "@/components/listas-precios/ImportarPreciosDialog";
import { ClientesLista } from "@/components/listas-precios/ClientesLista";
import { HistorialLista } from "@/components/listas-precios/HistorialLista";

// Detalle de una lista de precios (fase 21e). La lista completa de productos vendibles de la empresa, con el precio de
// la lista editable fila por fila (Enter / ↓ pasan a la siguiente). Los cambios quedan pendientes (resaltados) hasta
// "Guardar"; guardar_precios_lista los escribe y deja historial. Sin precio en la lista = el producto usa el precio base.
// La tabla no se pagina a propósito: se trabaja de corrido sobre todo el catálogo (≈100–300 productos por empresa).

type Estado = "todos" | "con" | "sin" | "pendientes";
interface Edicion { texto: string; origen: OrigenCambio }

const productosVendibles = (empresa: string | null) => {
  let q = supabase.from("productos").select("id, sku, nombre, precio_base, categoria_id, vendible, categoria:categorias(nombre)").eq("activo", true).order("nombre");
  if (empresa) q = q.or(`empresa_id.eq.${empresa},empresa_id.is.null`);
  return q;
};

const ListaPreciosDetalle = () => {
  const { listaId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { can } = usePermissions();
  const { empresas } = useEmpresa();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "productos";

  const [lista, setLista] = useState<ListaPrecio | null>(null);
  const [productos, setProductos] = useState<ProductoLista[]>([]);
  const [guardados, setGuardados] = useState<Map<string, number>>(new Map());
  const [nClientes, setNClientes] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ediciones, setEdiciones] = useState<Record<string, Edicion>>({});
  const [guardando, setGuardando] = useState(false);
  const [version, setVersion] = useState(0);

  const [busq, setBusq] = useState("");
  const [categoria, setCategoria] = useState("todas");
  const [estado, setEstado] = useState<Estado>("todos");
  const [ajuste, setAjuste] = useState(false);
  const [importar, setImportar] = useState(false);
  const [copiar, setCopiar] = useState(false);
  const [editar, setEditar] = useState(false);

  const cargar = useCallback(async () => {
    if (!listaId) return;
    setCargando(true);
    const { data: l } = await supabase.from("listas_precios").select("id, nombre, descripcion, activo, moneda, empresa_id, odoo_id, updated_at").eq("id", listaId).maybeSingle();
    const lp = (l as ListaPrecio | null) ?? null;
    setLista(lp);
    if (lp) {
      const [{ data: prods }, { data: precios }] = await Promise.all([
        productosVendibles(lp.empresa_id),
        supabase.from("precios_lista").select("producto_id, precio").eq("lista_precios_id", lp.id),
      ]);
      setProductos(((prods ?? []) as unknown as (ProductoLista & { vendible: boolean | null; categoria: { nombre: string } | null })[])
        .filter((p) => p.vendible !== false)
        .map((p) => ({ id: p.id, sku: p.sku, nombre: p.nombre, precio_base: Number(p.precio_base ?? 0), categoria_id: p.categoria_id, categoria: p.categoria?.nombre?.trim() ?? null })));
      setGuardados(new Map(((precios ?? []) as { producto_id: string; precio: number }[]).map((r) => [r.producto_id, Number(r.precio)])));
    }
    setCargando(false);
  }, [listaId]);
  useEffect(() => { cargar(); }, [cargar]);

  const editable = !!lista && esDeGuds(lista) && can("precios", "editar");
  const pendientes = useMemo(() => Object.entries(ediciones).filter(([id, e]) => {
    const v = leerPrecio(e.texto);
    const g = guardados.get(id) ?? null;
    return Number.isNaN(v as number) || (v == null ? g != null : g == null || redondear(v, 4) !== redondear(g, 4));
  }), [ediciones, guardados]);
  const invalidos = pendientes.filter(([, e]) => { const v = leerPrecio(e.texto); return v != null && (Number.isNaN(v) || v < 0); });
  const hayPendientes = pendientes.length > 0;
  const idsPendientes = useMemo(() => new Set(pendientes.map(([id]) => id)), [pendientes]);

  // Avisar antes de salir con cambios sin guardar
  useEffect(() => {
    if (!hayPendientes) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [hayPendientes]);

  /** Precio vigente en pantalla: el editado, o el guardado; null = usa el base. */
  const precioDe = useCallback((p: ProductoLista): number | null => {
    const e = ediciones[p.id];
    if (e) { const v = leerPrecio(e.texto); return v == null || Number.isNaN(v) ? null : v; }
    return guardados.get(p.id) ?? null;
  }, [ediciones, guardados]);

  const categorias = useMemo(() => {
    const m = new Map<string, { nombre: string; n: number }>();
    for (const p of productos) { const k = p.categoria_id ?? "sin"; const x = m.get(k) ?? { nombre: p.categoria ?? "Sin categoría", n: 0 }; x.n++; m.set(k, x); }
    return [...m.entries()].sort((a, b) => a[1].nombre.localeCompare(b[1].nombre));
  }, [productos]);

  const filas = useMemo(() => {
    const t = normalizar(busq);
    return productos.filter((p) => (!t || normalizar(`${p.nombre} ${p.sku} ${p.categoria ?? ""}`).includes(t))
      && (categoria === "todas" || (p.categoria_id ?? "sin") === categoria)
      && (estado === "todos" || (estado === "pendientes" ? idsPendientes.has(p.id) : estado === "con" ? precioDe(p) != null : precioDe(p) == null)));
  }, [productos, busq, categoria, estado, idsPendientes, precioDe]);

  const conPrecio = productos.filter((p) => guardados.has(p.id)).length;
  // Sin los productos a 1 USD o menos: es el precio de relleno de Odoo y desvirtúa el promedio
  const difProm = useMemo(() => {
    const ds = productos.filter((p) => guardados.has(p.id) && p.precio_base > 1).map((p) => difPct(guardados.get(p.id)!, p.precio_base)!);
    return ds.length ? ds.reduce((s, d) => s + d, 0) / ds.length : null;
  }, [productos, guardados]);

  const editarCelda = (id: string, texto: string, origen: OrigenCambio = "manual") => setEdiciones((e) => ({ ...e, [id]: { texto, origen } }));
  const aplicarLote = (cambios: Record<string, number | null>, origen: OrigenCambio) =>
    setEdiciones((e) => ({ ...e, ...Object.fromEntries(Object.entries(cambios).map(([id, v]) => [id, { texto: v == null ? "" : textoPrecio(v), origen }])) }));

  const guardar = async () => {
    if (!lista || invalidos.length) return;
    setGuardando(true);
    // Un llamado por origen, para que el historial diga de dónde vino cada cambio
    const porOrigen = new Map<OrigenCambio, { producto_id: string; precio: number | null }[]>();
    for (const [id, e] of pendientes) {
      const v = leerPrecio(e.texto);
      (porOrigen.get(e.origen) ?? porOrigen.set(e.origen, []).get(e.origen)!).push({ producto_id: id, precio: v == null ? null : redondear(v, 4) });
    }
    let total = 0;
    for (const [origen, items] of porOrigen) {
      const { data, error } = await supabase.rpc("guardar_precios_lista", { p_lista: lista.id, p_items: items, p_origen: origen });
      if (error) { setGuardando(false); toast({ title: "No se pudieron guardar los precios", description: error.message, variant: "destructive" }); await cargar(); return; }
      const r = data as { nuevos: number; cambiados: number; quitados: number };
      total += r.nuevos + r.cambiados + r.quitados;
    }
    setGuardando(false);
    setEdiciones({});
    toast({ title: "Precios guardados", description: `${total} cambio${total === 1 ? "" : "s"} en «${lista.nombre}».` });
    setVersion((v) => v + 1);
    await cargar();
  };

  const exportar = async () => {
    if (!lista) return;
    const XLSX = await import("xlsx");
    const filasX = productos.map((p) => ({
      "Código": p.sku, "Producto": p.nombre, "Categoría": p.categoria ?? "", "Precio base (USD)": p.precio_base,
      "Precio": guardados.get(p.id) ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(filasX);
    ws["!cols"] = [{ wch: 14 }, { wch: 50 }, { wch: 28 }, { wch: 16 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Precios");
    XLSX.writeFile(wb, `Lista de precios - ${lista.nombre}.xlsx`);
  };

  // Enter / ↓ / ↑ entre filas del precio
  const mover = (desde: HTMLInputElement, paso: number) => {
    const todos = Array.from(document.querySelectorAll<HTMLInputElement>("input[data-precio-fila]"));
    const i = todos.indexOf(desde);
    const sig = todos[i + paso];
    if (sig) { sig.focus(); sig.select(); }
  };

  const volver = (
    <Button variant="ghost" size="sm" className="mb-2 h-7 gap-1.5 px-2 text-xs"
      onClick={() => { if (!hayPendientes || window.confirm("Hay precios sin guardar. ¿Salir igual?")) navigate("/admin/precios"); }}>
      <ArrowLeft className="h-3.5 w-3.5" /> Volver a listas de precios
    </Button>
  );
  if (cargando && !lista) return <MainLayout title="Lista de precios">{volver}<div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></MainLayout>;
  if (!lista) return <MainLayout title="Lista de precios">{volver}<div className="flex flex-col items-center py-20 text-muted-foreground"><Tags className="mb-4 h-12 w-12 opacity-50" /><p>Lista no encontrada</p></div></MainLayout>;

  const empresa = empresas.find((e) => e.id === lista.empresa_id)?.nombre_corto;

  return (
    <MainLayout title={lista.nombre}>
      {volver}
      <div className="mb-3 flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-1.5 text-base font-semibold">
            {lista.nombre}
            {esDeGuds(lista) ? <Badge variant="outline" className="px-1.5 py-0 text-[10px]">Lista de GUDS</Badge> : <OdooBadge titulo="Lista de Odoo · se edita en Odoo" />}
            {!lista.activo && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">Inactiva</Badge>}
          </h1>
          <p className="text-sm text-muted-foreground">{[empresa ?? "Ambas empresas", lista.moneda ?? "USD", lista.descripcion].filter(Boolean).join(" · ")}</p>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditar(true)}><Edit className="h-3.5 w-3.5" /> Editar</Button>
          </div>
        )}
      </div>
      {!esDeGuds(lista) && (
        <p className="mb-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          Esta lista viene de Odoo: sus precios y clientes se cambian en Odoo. Para precios personalizados producto por producto, crea una lista de GUDS.
        </p>
      )}

      <KpiStrip items={[
        { label: "Con precio en la lista", valor: `${conPrecio} de ${productos.length}`, tono: "primario" },
        { label: "Usan precio base", valor: productos.length - conPrecio },
        { label: "Dif. promedio vs base", titulo: "Sin contar productos con precio base de 1 USD o menos (relleno de Odoo)", valor: difProm == null ? "—" : `${difProm > 0 ? "+" : ""}${difProm.toFixed(1)} %`, tono: difProm != null && difProm < 0 ? "positivo" : "normal" },
        { label: "Clientes", valor: nClientes ?? "—", onClick: () => setParams({ tab: "clientes" }, { replace: true }) },
      ]} />

      <Tabs value={tab} onValueChange={(t) => setParams(t === "productos" ? {} : { tab: t }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="productos">Productos y precios</TabsTrigger>
          <TabsTrigger value="clientes">Clientes{nClientes != null ? ` (${nClientes})` : ""}</TabsTrigger>
          <TabsTrigger value="historial">Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="productos">
          <BarraLista
            busqueda={busq} onBusqueda={setBusq} placeholder="Buscar producto, código o categoría…"
            filtros={
              <div className="flex flex-wrap gap-2">
                <Select value={categoria} onValueChange={setCategoria}>
                  <SelectTrigger className="h-8 w-full text-xs sm:w-48" aria-label="Categoría"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas las categorías</SelectItem>
                    {categorias.map(([k, c]) => <SelectItem key={k} value={k}>{c.nombre} ({c.n})</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={estado} onValueChange={(v) => setEstado(v as Estado)}>
                  <SelectTrigger className="h-8 w-full text-xs sm:w-44" aria-label="Precio"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos los productos</SelectItem>
                    <SelectItem value="con">Con precio en la lista</SelectItem>
                    <SelectItem value="sin">Sin precio (usa base)</SelectItem>
                    <SelectItem value="pendientes">Cambios sin guardar ({pendientes.length})</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            }
            contador={`${filas.length} de ${productos.length}`}
            acciones={
              <div className="flex flex-wrap gap-1.5">
                {editable && <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAjuste(true)} disabled={!filas.length} data-testid="lista-ajuste"><Percent className="h-3.5 w-3.5" /> Ajuste masivo</Button>}
                {editable && <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setCopiar(true)}><Copy className="h-3.5 w-3.5" /> Copiar de otra lista</Button>}
                {editable && <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setImportar(true)} disabled={hayPendientes}
                  title={hayPendientes ? "Guarda o descarta los cambios antes de importar" : undefined} data-testid="lista-importar"><FileUp className="h-3.5 w-3.5" /> Importar</Button>}
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={exportar}><Download className="h-3.5 w-3.5" /> Exportar</Button>
              </div>
            }
          />

          <div className="rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden w-28 sm:table-cell">Código</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Precio base</TableHead>
                  <TableHead className="w-24 text-right sm:w-36"><span className="sm:hidden">Precio</span><span className="hidden sm:inline">Precio lista (USD)</span></TableHead>
                  <TableHead className="hidden w-20 text-right sm:table-cell">vs base</TableHead>
                  {editable && <TableHead className="w-9" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filas.map((p) => {
                  const e = ediciones[p.id];
                  const guardado = guardados.get(p.id);
                  const texto = e ? e.texto : textoPrecio(guardado);
                  const v = leerPrecio(texto);
                  const malo = v != null && (Number.isNaN(v) || v < 0);
                  const pendiente = idsPendientes.has(p.id);
                  const d = v != null && !malo ? difPct(v, p.precio_base) : null;
                  return (
                    <TableRow key={p.id} className={cn(pendiente && "bg-amber-50/70 dark:bg-amber-500/10")} data-testid="lista-fila">
                      <TableCell className="hidden whitespace-nowrap font-mono text-xs text-primary sm:table-cell">{p.sku}</TableCell>
                      <TableCell className="min-w-[150px] max-w-[420px] whitespace-normal">
                        <p className="line-clamp-2 break-words text-[13px] font-medium sm:line-clamp-1" title={p.nombre}>{p.nombre}</p>
                        <p className="line-clamp-1 break-all text-[11px] text-muted-foreground"><span className="sm:hidden">{p.sku} · </span>{p.categoria ?? "Sin categoría"}<span className="md:hidden"> · base {fmtUsd(p.precio_base)}</span></p>
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground md:table-cell">{fmtUsd(p.precio_base)}</TableCell>
                      <TableCell className="py-1 text-right">
                        {editable ? (
                          <Input
                            value={texto} inputMode="decimal" data-precio-fila="" aria-label={`Precio de ${p.nombre} en la lista`}
                            placeholder={`${textoPrecio(p.precio_base)} (base)`}
                            onChange={(ev) => editarCelda(p.id, ev.target.value)}
                            onFocus={(ev) => ev.target.select()}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter" || ev.key === "ArrowDown") { ev.preventDefault(); mover(ev.currentTarget, 1); }
                              else if (ev.key === "ArrowUp") { ev.preventDefault(); mover(ev.currentTarget, -1); }
                              else if (ev.key === "Escape" && e) { ev.preventDefault(); setEdiciones(({ [p.id]: _, ...resto }) => resto); }
                            }}
                            className={cn("ml-auto h-8 w-[5.5rem] text-right text-[13px] tabular-nums placeholder:text-muted-foreground/60 sm:w-32",
                              malo && "border-destructive focus-visible:ring-destructive", pendiente && !malo && "border-amber-400")}
                          />
                        ) : (
                          <span className="text-[13px] tabular-nums">{guardado != null ? fmtUsd(guardado) : <span className="text-muted-foreground">base</span>}</span>
                        )}
                      </TableCell>
                      <TableCell className={cn("hidden whitespace-nowrap text-right text-xs tabular-nums sm:table-cell", d == null ? "text-muted-foreground" : d < 0 ? "text-emerald-700 dark:text-emerald-400" : d > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                        {v == null ? "—" : d == null ? "" : `${d > 0 ? "+" : ""}${d.toFixed(1)} %`}
                      </TableCell>
                      {editable && (
                        <TableCell className="px-1 py-1">
                          {(v != null || pendiente) && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              title={pendiente ? "Deshacer el cambio" : "Quitar el precio (usa el base)"} aria-label={pendiente ? `Deshacer ${p.nombre}` : `Quitar precio de ${p.nombre}`}
                              onClick={() => pendiente ? setEdiciones(({ [p.id]: _, ...resto }) => resto) : editarCelda(p.id, "")}>
                              {pendiente ? <RotateCcw className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                {filas.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Sin productos con esta búsqueda.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>

          {editable && hayPendientes && (
            <div className="sticky bottom-2 z-20 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 shadow-lg dark:bg-amber-950" data-testid="lista-pendientes">
              <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
                {pendientes.length} cambio{pendientes.length === 1 ? "" : "s"} sin guardar
                {invalidos.length > 0 && <span className="ml-1 text-destructive">· {invalidos.length} precio{invalidos.length === 1 ? "" : "s"} inválido{invalidos.length === 1 ? "" : "s"}</span>}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEdiciones({})} disabled={guardando}>Descartar</Button>
                <Button size="sm" className="gap-1.5" onClick={guardar} disabled={guardando || invalidos.length > 0} data-testid="lista-guardar">
                  {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Guardar
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="clientes" forceMount className="data-[state=inactive]:hidden">
          <ClientesLista lista={lista} editable={editable} onCambio={setNClientes} />
        </TabsContent>
        <TabsContent value="historial">
          <HistorialLista listaId={lista.id} version={version} />
        </TabsContent>
      </Tabs>

      <AjusteMasivoDialog abierto={ajuste} onOpenChange={setAjuste} filas={filas} precioActual={precioDe} onAplicar={(c) => aplicarLote(c, "masivo")} />
      <ImportarPreciosDialog abierto={importar} onOpenChange={setImportar} listaId={lista.id} productos={productos} guardados={guardados}
        onHecho={() => { setVersion((v) => v + 1); cargar(); }} />
      <CopiarDeListaDialog abierto={copiar} onOpenChange={setCopiar} lista={lista} productos={productos} onAplicar={(c) => aplicarLote(c, "copia")} />
      <EditarListaDialog abierto={editar} onOpenChange={setEditar} lista={lista} onHecho={cargar} />
    </MainLayout>
  );
};

/** Trae los precios de otra lista de la misma empresa como cambios pendientes (opcionalmente con un % encima). */
function CopiarDeListaDialog({ abierto, onOpenChange, lista, productos, onAplicar }: {
  abierto: boolean; onOpenChange: (v: boolean) => void; lista: ListaPrecio; productos: ProductoLista[]; onAplicar: (c: Record<string, number | null>) => void;
}) {
  const { toast } = useToast();
  const [otras, setOtras] = useState<{ id: string; nombre: string; n: number }[]>([]);
  const [origen, setOrigen] = useState("");
  const [pct, setPct] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  useEffect(() => {
    if (!abierto) return;
    let q = supabase.from("listas_precios").select("id, nombre, precios:precios_lista(count)").neq("id", lista.id).order("nombre");
    if (lista.empresa_id) q = q.or(`empresa_id.eq.${lista.empresa_id},empresa_id.is.null`);
    q.then(({ data }) => setOtras(((data ?? []) as unknown as { id: string; nombre: string; precios: { count: number }[] }[])
      .map((l) => ({ id: l.id, nombre: l.nombre, n: l.precios?.[0]?.count ?? 0 })).filter((l) => l.n > 0)));
  }, [abierto, lista.id, lista.empresa_id]);
  const n = pct.trim() === "" ? 0 : Number(pct.replace(",", "."));
  const aplicar = async () => {
    setTrabajando(true);
    const { data, error } = await supabase.from("precios_lista").select("producto_id, precio").eq("lista_precios_id", origen);
    setTrabajando(false);
    if (error) { toast({ title: "No se pudo leer la lista", description: error.message, variant: "destructive" }); return; }
    const ids = new Set(productos.map((p) => p.id));
    const cambios = Object.fromEntries(((data ?? []) as { producto_id: string; precio: number }[])
      .filter((r) => ids.has(r.producto_id)).map((r) => [r.producto_id, redondear(Number(r.precio) * (1 + n / 100))]));
    onAplicar(cambios);
    toast({ title: `${Object.keys(cambios).length} precios copiados`, description: "Revisa y guarda para aplicarlos." });
    onOpenChange(false);
  };
  return (
    <Dialog open={abierto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copiar precios de otra lista</DialogTitle>
          <DialogDescription>Los precios quedan como cambios pendientes; los productos sin precio en la otra lista no se tocan.</DialogDescription>
        </DialogHeader>
        {otras.length === 0 ? <p className="text-sm text-muted-foreground">No hay otras listas con precios en esta empresa.</p> : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Lista de origen</Label>
              <Select value={origen} onValueChange={setOrigen}>
                <SelectTrigger className="h-9"><SelectValue placeholder="Elegir lista…" /></SelectTrigger>
                <SelectContent>{otras.map((l) => <SelectItem key={l.id} value={l.id}>{l.nombre} ({l.n} precios)</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="copiar-pct">Ajuste opcional (%)</Label>
              <Input id="copiar-pct" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="0 · ej. -5" className="h-9" />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!origen || !Number.isFinite(n) || n <= -100 || trabajando} onClick={aplicar}>{trabajando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Copiar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditarListaDialog({ abierto, onOpenChange, lista, onHecho }: { abierto: boolean; onOpenChange: (v: boolean) => void; lista: ListaPrecio; onHecho: () => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ nombre: lista.nombre, descripcion: lista.descripcion ?? "", activo: lista.activo });
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { if (abierto) setForm({ nombre: lista.nombre, descripcion: lista.descripcion ?? "", activo: lista.activo }); }, [abierto, lista]);
  const guardar = async () => {
    if (!form.nombre.trim()) return;
    setGuardando(true);
    const { error } = await supabase.from("listas_precios").update({ nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null, activo: form.activo, updated_at: new Date().toISOString() }).eq("id", lista.id);
    setGuardando(false);
    if (error) { toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" }); return; }
    onOpenChange(false); onHecho();
  };
  return (
    <Dialog open={abierto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Editar lista</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="el-nombre">Nombre</Label><Input id="el-nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="el-desc">Descripción</Label><Textarea id="el-desc" rows={2} value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} /></div>
          <div className="flex items-center justify-between"><div><Label>Activa</Label><p className="text-xs text-muted-foreground">Inactiva: no se puede asignar a más clientes.</p></div><Switch checked={form.activo} onCheckedChange={(v) => setForm({ ...form, activo: v })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando || !form.nombre.trim()}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ListaPreciosDetalle;
