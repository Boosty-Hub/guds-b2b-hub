import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { fmtUsd } from "@/components/estado-cuenta/formato";

interface Cambio {
  id: number; created_at: string; precio_antes: number | null; precio_despues: number | null; origen: string;
  producto: { nombre: string; sku: string } | null; usuario: { nombre: string; apellido: string | null } | null;
}
interface Carga {
  id: string; created_at: string; archivo: string | null; filas: number; nuevos: number; cambiados: number; sin_cambio: number;
  no_encontrados: unknown[]; usuario: { nombre: string; apellido: string | null } | null;
}
const ORIGEN: Record<string, string> = { manual: "A mano", masivo: "Ajuste masivo", importacion: "Importación", copia: "Copia de lista" };
const fecha = (s: string) => new Date(s).toLocaleString("es-VE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const quien = (u: { nombre: string; apellido: string | null } | null) => (u ? `${u.nombre} ${u.apellido ?? ""}`.trim() : "—");

/** Últimos 1.000 cambios de precio de la lista y sus importaciones. */
export function HistorialLista({ listaId, version }: { listaId: string; version: number }) {
  const [cambios, setCambios] = useState<Cambio[]>([]);
  const [cargas, setCargas] = useState<Carga[]>([]);
  const [cargando, setCargando] = useState(true);
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    Promise.all([
      supabase.from("precios_lista_historial").select("id, created_at, precio_antes, precio_despues, origen, producto:productos(nombre, sku), usuario:usuarios(nombre, apellido)")
        .eq("lista_precios_id", listaId).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1000),
      supabase.from("precios_lista_cargas").select("id, created_at, archivo, filas, nuevos, cambiados, sin_cambio, no_encontrados, usuario:usuarios(nombre, apellido)")
        .eq("lista_precios_id", listaId).order("created_at", { ascending: false }).limit(50),
    ]).then(([h, c]) => {
      if (!vivo) return;
      setCambios((h.data as unknown as Cambio[]) ?? []);
      setCargas((c.data as unknown as Carga[]) ?? []);
      setCargando(false);
    });
    return () => { vivo = false; };
  }, [listaId, version]);
  const pag = usePagination(cambios, 50);

  if (cargando) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  return (
    <div className="space-y-3">
      {cargas.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border bg-muted/30 px-3 py-1.5"><h2 className="text-[13px] font-semibold">Importaciones ({cargas.length})</h2></div>
          <Table>
            <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Archivo</TableHead><TableHead className="text-right">Filas</TableHead><TableHead className="text-right">Nuevos</TableHead><TableHead className="text-right">Cambiados</TableHead><TableHead className="text-right">Sin producto</TableHead><TableHead className="hidden sm:table-cell">Quién</TableHead></TableRow></TableHeader>
            <TableBody>
              {cargas.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap text-xs">{fecha(c.created_at)}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-xs" title={c.archivo ?? undefined}>{c.archivo ?? "—"}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{c.filas}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{c.nuevos}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{c.cambiados}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{Array.isArray(c.no_encontrados) ? c.no_encontrados.length : 0}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{quien(c.usuario)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border bg-muted/30 px-3 py-1.5"><h2 className="text-[13px] font-semibold">Cambios de precio ({cambios.length}{cambios.length === 1000 ? "+" : ""})</h2></div>
        {cambios.length === 0 ? <p className="p-5 text-center text-sm text-muted-foreground">Sin cambios todavía.</p> : (
          <>
            <Table>
              <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Producto</TableHead><TableHead className="text-right">Antes</TableHead><TableHead className="text-right">Después</TableHead><TableHead className="hidden sm:table-cell">Origen</TableHead><TableHead className="hidden md:table-cell">Quién</TableHead></TableRow></TableHeader>
              <TableBody>
                {pag.pageItems.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap text-xs">{fecha(c.created_at)}</TableCell>
                    <TableCell className="max-w-[260px] truncate text-xs" title={c.producto?.nombre}><span className="font-medium">{c.producto?.nombre ?? "—"}</span> <span className="text-muted-foreground">{c.producto?.sku}</span></TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">{c.precio_antes == null ? "base" : fmtUsd(c.precio_antes)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs font-medium tabular-nums">{c.precio_despues == null ? "quitado" : fmtUsd(c.precio_despues)}</TableCell>
                    <TableCell className="hidden sm:table-cell"><Badge variant="outline" className="px-1.5 py-0 text-[10px]">{ORIGEN[c.origen] ?? c.origen}</Badge></TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{quien(c.usuario)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination pagination={pag} />
          </>
        )}
      </div>
    </div>
  );
}
