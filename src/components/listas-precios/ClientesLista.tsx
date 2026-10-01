import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { normalizar, type ListaPrecio } from "./comun";

interface ClienteFila {
  id: string; nombre_negocio: string; rif: string | null; ciudad: string | null; lista_precios_id: string | null;
  lista: { nombre: string } | null; vendedor: { nombre: string; apellido: string | null } | null;
}
const nombreVendedor = (c: ClienteFila) => (c.vendedor ? `${c.vendedor.nombre} ${c.vendedor.apellido ?? ""}`.trim() : "Sin vendedor");

/** Clientes de la lista. Asignar y quitar pasan por asignar_lista_clientes (valida permiso y empresa). */
export function ClientesLista({ lista, editable, onCambio }: { lista: ListaPrecio; editable: boolean; onCambio: (n: number) => void }) {
  const { toast } = useToast();
  const [todos, setTodos] = useState<ClienteFila[]>([]);
  const [cargando, setCargando] = useState(true);
  const [agregar, setAgregar] = useState(false);
  const [busq, setBusq] = useState("");
  const [vend, setVend] = useState("todos");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    let q = supabase.from("clientes")
      .select("id, nombre_negocio, rif, ciudad, lista_precios_id, lista:listas_precios(nombre), vendedor:usuarios!clientes_vendedor_asignado_id_fkey(nombre, apellido)")
      .eq("activo", true).eq("es_empleado", false).order("nombre_negocio");
    if (lista.empresa_id) q = q.eq("empresa_id", lista.empresa_id);
    const { data, error } = await q;
    if (error) toast({ title: "No se pudieron cargar los clientes", description: error.message, variant: "destructive" });
    setTodos((data as unknown as ClienteFila[]) ?? []);
    setCargando(false);
  }, [lista.empresa_id, toast]);
  useEffect(() => { cargar(); }, [cargar]);

  const asignados = useMemo(() => todos.filter((c) => c.lista_precios_id === lista.id), [todos, lista.id]);
  useEffect(() => { if (!cargando) onCambio(asignados.length); }, [asignados.length, cargando, onCambio]);
  const pag = usePagination(asignados, 50);

  const candidatos = useMemo(() => {
    const t = normalizar(busq);
    return todos.filter((c) => c.lista_precios_id !== lista.id
      && (!t || normalizar(`${c.nombre_negocio} ${c.rif ?? ""} ${c.ciudad ?? ""}`).includes(t))
      && (vend === "todos" || nombreVendedor(c) === vend));
  }, [todos, lista.id, busq, vend]);
  const vendedores = useMemo(() => [...new Set(todos.map(nombreVendedor))].sort(), [todos]);

  const ejecutar = async (ids: string[], quitar: boolean) => {
    setGuardando(true);
    const { data, error } = await supabase.rpc("asignar_lista_clientes", { p_lista: lista.id, p_clientes: ids, p_quitar: quitar });
    setGuardando(false);
    if (error) { toast({ title: quitar ? "No se pudo quitar" : "No se pudo asignar", description: error.message, variant: "destructive" }); return false; }
    toast({ title: quitar ? "Cliente quitado de la lista" : `${data} cliente${data === 1 ? "" : "s"} con esta lista`,
      description: quitar ? "Vuelve a la lista que tiene en Odoo con la próxima sincronización." : undefined });
    await cargar();
    return true;
  };

  if (cargando) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
        <h2 className="text-[13px] font-semibold">Clientes con esta lista ({asignados.length})</h2>
        {editable && <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => { setSel(new Set()); setBusq(""); setAgregar(true); }} data-testid="lista-agregar-clientes"><Plus className="h-3.5 w-3.5" /> Agregar clientes</Button>}
      </div>
      {asignados.length === 0 ? (
        <p className="p-5 text-center text-sm text-muted-foreground">{editable ? "Ningún cliente usa esta lista todavía." : "Esta lista viene de Odoo y se asigna en Odoo."}</p>
      ) : (
        <>
          <Table>
            <TableHeader><TableRow><TableHead>Cliente</TableHead><TableHead className="hidden sm:table-cell">Vendedor</TableHead><TableHead className="hidden md:table-cell">Ciudad</TableHead>{editable && <TableHead className="w-12" />}</TableRow></TableHeader>
            <TableBody>
              {pag.pageItems.map((c) => (
                <TableRow key={c.id}>
                  <TableCell><Link to={`/admin/clientes/${c.id}`} className="font-medium hover:underline">{c.nombre_negocio}</Link><p className="text-xs text-muted-foreground">{c.rif}</p></TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{nombreVendedor(c)}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{c.ciudad ?? "—"}</TableCell>
                  {editable && (
                    <TableCell><Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" disabled={guardando}
                      title="Quitar de la lista" aria-label={`Quitar ${c.nombre_negocio} de la lista`} onClick={() => ejecutar([c.id], true)}><X className="h-3.5 w-3.5" /></Button></TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <DataTablePagination pagination={pag} />
        </>
      )}

      <Dialog open={agregar} onOpenChange={setAgregar}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Agregar clientes a «{lista.nombre}»</DialogTitle>
            <DialogDescription>Los productos que no tengan precio en esta lista usan el precio base.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={busq} onChange={(e) => setBusq(e.target.value)} placeholder="Buscar por nombre, RIF o ciudad…" className="h-8 text-[13px]" autoFocus />
            <Select value={vend} onValueChange={setVend}>
              <SelectTrigger className="h-8 text-xs sm:w-52" aria-label="Vendedor"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="todos">Todos los vendedores</SelectItem>{vendedores.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{sel.size} seleccionado{sel.size === 1 ? "" : "s"} · {candidatos.length} en la búsqueda</span>
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setSel(new Set([...sel, ...candidatos.map((c) => c.id)]))}>Seleccionar los {candidatos.length}</Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
            {candidatos.slice(0, 400).map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-0 hover:bg-muted/40">
                <Checkbox checked={sel.has(c.id)} onCheckedChange={(v) => { const n = new Set(sel); if (v) n.add(c.id); else n.delete(c.id); setSel(n); }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.nombre_negocio}</span>
                  <span className="block truncate text-xs text-muted-foreground">{[c.rif, c.ciudad, nombreVendedor(c)].filter(Boolean).join(" · ")}</span>
                </span>
                {c.lista && <Badge variant="outline" className="max-w-[140px] shrink-0 truncate px-1.5 py-0 text-[10px]" title={`Lista actual: ${c.lista.nombre}`}>{c.lista.nombre}</Badge>}
              </label>
            ))}
            {candidatos.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">Sin clientes en la búsqueda.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAgregar(false)}>Cancelar</Button>
            <Button disabled={!sel.size || guardando} onClick={async () => { if (await ejecutar([...sel], false)) setAgregar(false); }} data-testid="lista-asignar">
              {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Asignar a {sel.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
