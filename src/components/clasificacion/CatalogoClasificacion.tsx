import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Pencil, Plus, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { usePermissions } from "@/contexts/PermissionsContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Panel } from "@/components/datos/FichaCampos";
import { cn } from "@/lib/utils";
import {
  ACCION_PLAN, DIMENSION, fechaHora, mensajeError, pistaError, type EstadoOdooClasif, type RevisionCatalogo, type TipoClasif,
} from "./comun";

interface Form { id: string | null; tipo: string; criterio: string; canal: string; categoria: string; orden: string; activo: boolean; por_confirmar: boolean; nota: string }
const vacio: Form = { id: null, tipo: "", criterio: "", canal: "", categoria: "", orden: "", activo: true, por_confirmar: false, nota: "" };

/** Catálogo de finanzas por empresa (tipo → canal → categoría de cobranza) y su revisión en Odoo. */
export function CatalogoClasificacion({ tipos, asignados, estadoOdoo, onCambio }: {
  tipos: TipoClasif[]; asignados: Map<string, number>; estadoOdoo: EstadoOdooClasif | null; onCambio: () => void;
}) {
  const { toast } = useToast();
  const { empresas, empresaActiva, soloLectura } = useEmpresa();
  const { can } = usePermissions();
  const puedeEditar = !soloLectura && can("clasificacion_clientes", "editar");
  const puedeCrear = !soloLectura && can("clasificacion_clientes", "crear");
  const [form, setForm] = useState<Form | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [revisando, setRevisando] = useState(false);

  const visibles = empresaActiva ? empresas.filter((e) => e.id === empresaActiva.id) : empresas;
  // Mientras la revisión del catálogo está en la cola, se refresca solo
  const enCola = (estadoOdoo?.catalogo ?? []).some((r) => r.estado === "pendiente" || r.estado === "procesando");
  useEffect(() => {
    if (!enCola) return;
    const t = setInterval(onCambio, 4000);
    return () => clearInterval(t);
  }, [enCola, onCambio]);

  const sugerencias = useMemo(() => ({
    canal: [...new Set(tipos.filter((t) => t.empresa_id === empresaActiva?.id && t.canal).map((t) => t.canal!))],
    categoria: [...new Set(tipos.filter((t) => t.empresa_id === empresaActiva?.id && t.categoria_cobranza).map((t) => t.categoria_cobranza!))],
  }), [tipos, empresaActiva?.id]);

  const guardar = async () => {
    if (!form) return;
    setGuardando(true);
    const { error } = await supabase.rpc("guardar_clasificacion_tipo", {
      p_id: form.id, p_tipo: form.tipo, p_criterio: form.criterio || null, p_canal: form.canal || null, p_categoria: form.categoria || null,
      p_orden: form.orden ? Number(form.orden) : null, p_activo: form.activo, p_por_confirmar: form.por_confirmar, p_nota: form.nota || null,
    });
    setGuardando(false);
    if (error) { toast({ title: "No se pudo guardar el tipo", description: mensajeError(error), variant: "destructive" }); return; }
    toast({ title: form.id ? "Tipo actualizado" : "Tipo creado" });
    setForm(null);
    onCambio();
  };

  const revisar = async () => {
    setRevisando(true);
    const { error } = await supabase.rpc("preparar_catalogo_clasificacion_odoo");
    setRevisando(false);
    if (error) { toast({ title: "No se pudo revisar el catálogo en Odoo", description: mensajeError(error), variant: "destructive" }); return; }
    toast({ title: estadoOdoo?.modo === "activo" ? "Creando en Odoo los valores que faltan…" : "Revisando el catálogo en Odoo (modo prueba)…" });
    onCambio();
  };

  return (
    <div className="space-y-3" data-testid="clasificacion-catalogo">
      {visibles.map((e) => {
        const filas = tipos.filter((t) => t.empresa_id === e.id);
        const conCanal = filas.some((t) => t.canal);
        const revision = estadoOdoo?.catalogo.find((r) => r.empresa_id === e.id) ?? null;
        return (
          <div key={e.id} className="space-y-3">
            <Panel sinPadding titulo={<>Catálogo de {e.nombre_corto} <span className="font-normal text-muted-foreground">· {filas.length} tipos</span></>}
              acciones={puedeCrear && empresaActiva?.id === e.id ? (
                <Button size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setForm({ ...vacio })} data-testid="clasificacion-nuevo-tipo"><Plus className="h-3.5 w-3.5" /> Nuevo tipo</Button>
              ) : undefined}>
              <Table data-tabla={`clasificacion-tipos-${e.nombre_corto}`} containerClassName="max-h-none">
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo de cliente</TableHead>
                    <TableHead className="hidden md:table-cell">Criterio</TableHead>
                    {conCanal && <TableHead>Canal</TableHead>}
                    <TableHead>Categoría de cobranza</TableHead>
                    <TableHead className="text-right">Clientes</TableHead>
                    <TableHead className="whitespace-nowrap">En Odoo</TableHead>
                    {puedeEditar && empresaActiva?.id === e.id && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filas.map((t) => (
                    <TableRow key={t.id} className={cn(!t.activo && "opacity-60")}>
                      <TableCell className="min-w-[150px]">
                        <span className="font-medium">{t.tipo}</span>
                        {t.por_confirmar && <Badge variant="outline" className="ml-1.5 border-warning/60 bg-warning/15 px-1 py-0 text-[10px]">Por confirmar</Badge>}
                        {!t.activo && <Badge variant="secondary" className="ml-1.5 px-1 py-0 text-[10px]">Inactivo</Badge>}
                        {t.nota && <p className="mt-0.5 text-[11px] text-muted-foreground">{t.nota}</p>}
                      </TableCell>
                      <TableCell className="hidden max-w-[320px] text-xs text-muted-foreground md:table-cell">{t.criterio ?? "—"}</TableCell>
                      {conCanal && <TableCell className="whitespace-nowrap text-xs">{t.canal ?? <span className="text-muted-foreground">—</span>}</TableCell>}
                      <TableCell className="whitespace-nowrap text-xs">{t.categoria_cobranza ?? <span className="text-warning">falta</span>}</TableCell>
                      <TableCell className="text-right">{asignados.get(t.id) ?? 0}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-[11px] text-muted-foreground"
                        title="Ids en Odoo de la Industria, el Canal y el Segmento de contacto (se llenan al crearlos o encontrarlos)">
                        {t.odoo_industry_id || t.odoo_channel_id || t.odoo_segment_id
                          ? [t.odoo_industry_id, ...(t.canal ? [t.odoo_channel_id] : []), t.odoo_segment_id].map((v) => v ?? "·").join(" / ")
                          : "por crear"}
                      </TableCell>
                      {puedeEditar && empresaActiva?.id === e.id && (
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Editar ${t.tipo}`}
                            onClick={() => setForm({ id: t.id, tipo: t.tipo, criterio: t.criterio ?? "", canal: t.canal ?? "", categoria: t.categoria_cobranza ?? "",
                              orden: String(t.orden), activo: t.activo, por_confirmar: t.por_confirmar, nota: t.nota ?? "" })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
            <RevisionOdoo empresa={e.nombre_corto} revision={revision} modo={estadoOdoo?.modo ?? "simular"}
              accion={puedeEditar && empresaActiva?.id === e.id ? { revisar, revisando: revisando || enCola } : null} />
          </div>
        );
      })}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar tipo de cliente" : "Nuevo tipo de cliente"}</DialogTitle>
            <DialogDescription>
              Catálogo de {empresaActiva?.nombre_corto}. En Odoo: el tipo es la Industria, el canal el Canal de contacto y la categoría el Segmento de contacto
              (valores compartidos por las dos empresas). Cambiar un nombre no borra el valor viejo en Odoo.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><Label htmlFor="ct-tipo">Tipo de cliente</Label>
                <Input id="ct-tipo" value={form.tipo} maxLength={100} onChange={(ev) => setForm({ ...form, tipo: ev.target.value })} /></div>
              <div className="sm:col-span-2"><Label htmlFor="ct-criterio">Criterio</Label>
                <Input id="ct-criterio" value={form.criterio} onChange={(ev) => setForm({ ...form, criterio: ev.target.value })} placeholder="Cómo se reconoce (solo en GUDS)" /></div>
              <div><Label htmlFor="ct-canal">Canal</Label>
                <Input id="ct-canal" list="ct-canales" value={form.canal} maxLength={100} onChange={(ev) => setForm({ ...form, canal: ev.target.value })} placeholder={sugerencias.canal.length ? "" : "No aplica"} />
                <datalist id="ct-canales">{sugerencias.canal.map((c) => <option key={c} value={c} />)}</datalist></div>
              <div><Label htmlFor="ct-cat">Categoría de cobranza</Label>
                <Input id="ct-cat" list="ct-cats" value={form.categoria} maxLength={100} onChange={(ev) => setForm({ ...form, categoria: ev.target.value })} />
                <datalist id="ct-cats">{sugerencias.categoria.map((c) => <option key={c} value={c} />)}</datalist></div>
              <div><Label htmlFor="ct-orden">Orden</Label>
                <Input id="ct-orden" type="number" value={form.orden} onChange={(ev) => setForm({ ...form, orden: ev.target.value })} /></div>
              <div className="flex flex-col justify-end gap-2">
                <label className="flex items-center gap-2 text-sm"><Switch checked={form.activo} onCheckedChange={(v) => setForm({ ...form, activo: v })} /> Activo</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={form.por_confirmar} onCheckedChange={(v) => setForm({ ...form, por_confirmar: v })} /> Por confirmar por finanzas</label>
              </div>
              <div className="sm:col-span-2"><Label htmlFor="ct-nota">Nota</Label>
                <Textarea id="ct-nota" rows={2} value={form.nota} onChange={(ev) => setForm({ ...form, nota: ev.target.value })} /></div>
              {form.por_confirmar && <p className="sm:col-span-2 text-xs text-muted-foreground">Los clientes de un tipo por confirmar no se envían a Odoo hasta completarlo y quitar la marca.</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancelar</Button>
            <Button onClick={guardar} disabled={guardando || !form?.tipo.trim()} data-testid="clasificacion-guardar-tipo">{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RevisionOdoo({ empresa, revision, modo, accion }: {
  empresa: string; revision: RevisionCatalogo | null; modo: string; accion: { revisar: () => void; revisando: boolean } | null;
}) {
  const r = revision?.resultado;
  const pista = pistaError(revision?.error);
  return (
    <Panel sinPadding titulo={<>Valores del catálogo en Odoo <span className="font-normal text-muted-foreground">· {empresa}</span></>}
      acciones={accion ? (
        <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs" disabled={accion.revisando} onClick={accion.revisar} data-testid="clasificacion-revisar-odoo">
          {accion.revisando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {modo === "activo" ? "Crear en Odoo lo que falta" : "Revisar en Odoo (modo prueba)"}
        </Button>
      ) : undefined}>
      {!revision ? (
        <p className="p-3 text-sm text-muted-foreground">Aún no se ha revisado qué valores existen en Odoo.</p>
      ) : (
        <div className="space-y-2 p-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {revision.estado === "simulada" ? "Modo prueba: así quedaría Odoo (no se escribió nada)." : revision.estado === "hecha" ? "Aplicado en Odoo." : revision.estado === "error" ? "La revisión falló." : "En la cola…"}
            {" "}{fechaHora(revision.procesado_at ?? revision.created_at)}
            {r?.resumen && <> · <b>{r.resumen.crear}</b> por crear, <b>{r.resumen.renombrar}</b> con nombre por ajustar, <b>{r.resumen.reusar}</b> ya existen</>}
          </p>
          {revision.error && <p className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{revision.error}{pista && <span className="block text-foreground">{pista}</span>}</p>}
          {(r?.avisos ?? []).map((a) => <p key={a} className="flex items-center gap-1 text-xs text-warning"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{a}</p>)}
          {r?.plan && r.plan.length > 0 && (
            <Table containerClassName="max-h-72">
              <TableHeader><TableRow><TableHead>Campo en Odoo</TableHead><TableHead>Valor</TableHead><TableHead>Qué hace</TableHead><TableHead className="text-right">Id Odoo</TableHead></TableRow></TableHeader>
              <TableBody>
                {r.plan.map((p) => (
                  <TableRow key={`${p.dimension}-${p.nombre}`}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{DIMENSION[p.dimension]}</TableCell>
                    <TableCell className="text-xs font-medium">{p.nombre}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      <span className={cn(p.accion === "crear" && "text-primary", p.accion === "renombrar" && "text-warning")}>{ACCION_PLAN[p.accion]}</span>
                      {p.antes && <span className="text-muted-foreground"> (hoy "{p.antes}")</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{p.odoo_id ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </Panel>
  );
}
