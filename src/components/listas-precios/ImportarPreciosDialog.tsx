import { useMemo, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { fmtUsd } from "@/components/estado-cuenta/formato";
import { cn } from "@/lib/utils";
import { leerPrecio, normalizar, redondear, type ProductoLista } from "./comun";

// Importar una lista desde Excel o CSV (5.2): subir → elegir columnas (código y/o nombre, precio) → emparejar con los
// productos de la empresa (código exacto, luego nombre exacto) → vista previa → confirmar. Cada carga queda registrada
// (precios_lista_cargas) y cada cambio en el historial. Una celda de precio vacía no toca el precio actual.

type Estado = "nuevo" | "sube" | "baja" | "igual" | "no_encontrado" | "invalido" | "vacio";
const ETIQUETA: Record<Estado, string> = {
  nuevo: "Nuevo", sube: "Sube", baja: "Baja", igual: "Sin cambio", no_encontrado: "No encontrado", invalido: "Precio inválido", vacio: "Sin precio (se ignora)",
};
const TONO: Record<Estado, string> = {
  nuevo: "border-sky-300 text-sky-800 dark:text-sky-300", sube: "border-amber-300 text-amber-800 dark:text-amber-300",
  baja: "border-emerald-300 text-emerald-800 dark:text-emerald-300", igual: "text-muted-foreground",
  no_encontrado: "border-red-300 text-red-800 dark:text-red-300", invalido: "border-red-300 text-red-800 dark:text-red-300", vacio: "text-muted-foreground",
};

interface Fila { n: number; codigo: string; nombre: string; precioTxt: string; precio: number | null; producto: ProductoLista | null; estado: Estado; antes: number | null; por: "codigo" | "nombre" | null }

const NINGUNA = "__ninguna";
const adivinar = (cabeceras: string[], patrones: RegExp[]) => {
  for (const re of patrones) { const i = cabeceras.findIndex((c) => re.test(normalizar(c))); if (i >= 0) return String(i); }
  return NINGUNA;
};

export function ImportarPreciosDialog({ abierto, onOpenChange, listaId, productos, guardados, onHecho }: {
  abierto: boolean;
  onOpenChange: (v: boolean) => void;
  listaId: string;
  productos: ProductoLista[];
  /** Precios guardados hoy en la lista: producto → precio. */
  guardados: Map<string, number>;
  onHecho: () => void;
}) {
  const { toast } = useToast();
  const [archivo, setArchivo] = useState<string | null>(null);
  const [hojas, setHojas] = useState<Record<string, unknown[][]>>({});
  const [hoja, setHoja] = useState("");
  const [colCodigo, setColCodigo] = useState(NINGUNA);
  const [colNombre, setColNombre] = useState(NINGUNA);
  const [colPrecio, setColPrecio] = useState(NINGUNA);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [verTodo, setVerTodo] = useState(false);

  const reiniciar = () => { setArchivo(null); setHojas({}); setHoja(""); setColCodigo(NINGUNA); setColNombre(NINGUNA); setColPrecio(NINGUNA); setVerTodo(false); };

  // Primera fila con al menos dos celdas con texto = cabeceras
  const filasHoja = useMemo(() => hojas[hoja] ?? [], [hojas, hoja]);
  const iCab = Math.max(0, filasHoja.findIndex((r) => r.filter((c) => String(c ?? "").trim() !== "").length >= 2));
  const cabeceras = (filasHoja[iCab] ?? []).map((c, i) => String(c ?? "").trim() || `Columna ${i + 1}`);

  const elegirHoja = (nombre: string, todas = hojas) => {
    setHoja(nombre);
    const filas = todas[nombre] ?? [];
    const i = Math.max(0, filas.findIndex((r) => r.filter((c) => String(c ?? "").trim() !== "").length >= 2));
    const cab = (filas[i] ?? []).map((c) => String(c ?? ""));
    setColCodigo(adivinar(cab, [/^(sku|codigo|cod|referencia|ref)\b/, /c.{0,2}digo|sku|referencia/]));
    setColNombre(adivinar(cab, [/^(producto|descripcion|nombre|articulo)\b/, /producto|descripcion|nombre/]));
    setColPrecio(adivinar(cab, [/^precio\b/, /precio|price|pvp|monto/]));
  };

  const leerArchivo = async (f: File) => {
    setLeyendo(true);
    try {
      const XLSX = await import("xlsx");
      // Un CSV se lee como texto UTF-8 (leído como bytes, "Código" llega como "CÃ³digo"); Excel, como binario
      const esCsv = /\.csv$/i.test(f.name) || f.type === "text/csv";
      const wb = esCsv ? XLSX.read((await f.text()).replace(/^\uFEFF/, ""), { type: "string", raw: true }) : XLSX.read(await f.arrayBuffer(), { type: "array" });
      const todas: Record<string, unknown[][]> = {};
      for (const nombre of wb.SheetNames) {
        todas[nombre] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nombre], { header: 1, raw: true, defval: "" });
      }
      const primera = wb.SheetNames.find((n) => (todas[n] ?? []).length > 1) ?? wb.SheetNames[0];
      setArchivo(f.name); setHojas(todas); elegirHoja(primera, todas);
    } catch (e) {
      toast({ title: "No se pudo leer el archivo", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setLeyendo(false); }
  };

  const porCodigo = useMemo(() => new Map(productos.filter((p) => p.sku).map((p) => [normalizar(p.sku), p])), [productos]);
  const porNombre = useMemo(() => {
    const m = new Map<string, ProductoLista | null>();
    for (const p of productos) { const k = normalizar(p.nombre); m.set(k, m.has(k) ? null : p); } // null = nombre repetido
    return m;
  }, [productos]);

  const filas: Fila[] = useMemo(() => {
    if (colPrecio === NINGUNA || (colCodigo === NINGUNA && colNombre === NINGUNA)) return [];
    const out: Fila[] = [];
    filasHoja.slice(iCab + 1).forEach((r, k) => {
      const codigo = colCodigo === NINGUNA ? "" : String(r[Number(colCodigo)] ?? "").trim();
      const nombre = colNombre === NINGUNA ? "" : String(r[Number(colNombre)] ?? "").trim();
      const celda = r[Number(colPrecio)];
      if (!codigo && !nombre) return;
      const precioTxt = typeof celda === "number" ? String(celda) : String(celda ?? "").trim();
      const precio = typeof celda === "number" ? celda : leerPrecio(precioTxt);
      let producto: ProductoLista | null = null; let por: Fila["por"] = null;
      if (codigo) { producto = porCodigo.get(normalizar(codigo)) ?? null; if (producto) por = "codigo"; }
      if (!producto && nombre) { producto = porNombre.get(normalizar(nombre)) ?? null; if (producto) por = "nombre"; }
      const antes = producto ? guardados.get(producto.id) ?? null : null;
      let estado: Estado;
      if (!producto) estado = "no_encontrado";
      else if (precio == null) estado = "vacio";
      else if (Number.isNaN(precio) || precio < 0) estado = "invalido";
      else if (antes == null) estado = "nuevo";
      else if (redondear(precio, 4) === redondear(antes, 4)) estado = "igual";
      else estado = precio > antes ? "sube" : "baja";
      out.push({ n: iCab + k + 2, codigo, nombre, precioTxt, precio: precio == null || Number.isNaN(precio) ? null : redondear(precio, 4), producto, estado, antes, por });
    });
    // Si un producto aparece dos veces, vale la última fila
    const ultima = new Map<string, number>();
    out.forEach((f, i) => { if (f.producto && f.precio != null) ultima.set(f.producto.id, i); });
    return out.filter((f, i) => !f.producto || f.precio == null || ultima.get(f.producto.id) === i);
  }, [filasHoja, iCab, colCodigo, colNombre, colPrecio, porCodigo, porNombre, guardados]);

  const conteo = filas.reduce((acc, f) => { acc[f.estado] = (acc[f.estado] ?? 0) + 1; return acc; }, {} as Partial<Record<Estado, number>>);
  const aplicables = filas.filter((f) => f.estado === "nuevo" || f.estado === "sube" || f.estado === "baja");
  const visibles = verTodo ? filas : filas.filter((f) => f.estado !== "igual" && f.estado !== "vacio");

  const confirmar = async () => {
    setGuardando(true);
    const noEncontrados = filas.filter((f) => f.estado === "no_encontrado").slice(0, 500).map((f) => ({ fila: f.n, codigo: f.codigo, nombre: f.nombre, precio: f.precioTxt }));
    const { data, error } = await supabase.rpc("guardar_precios_lista", {
      p_lista: listaId, p_origen: "importacion", p_archivo: archivo, p_no_encontrados: noEncontrados,
      p_items: aplicables.map((f) => ({ producto_id: f.producto!.id, precio: f.precio })),
    });
    setGuardando(false);
    if (error) { toast({ title: "No se pudo importar", description: error.message, variant: "destructive" }); return; }
    const r = data as { nuevos: number; cambiados: number };
    toast({ title: "Lista importada", description: `${r.nuevos} precios nuevos y ${r.cambiados} cambiados${noEncontrados.length ? ` · ${noEncontrados.length} filas sin producto` : ""}.` });
    reiniciar(); onOpenChange(false); onHecho();
  };

  const selectorColumna = (id: string, etiqueta: string, valor: string, set: (v: string) => void, opcional = false) => (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{etiqueta}</Label>
      <Select value={valor} onValueChange={set}>
        <SelectTrigger id={id} className="h-8 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {opcional && <SelectItem value={NINGUNA}>— Ninguna —</SelectItem>}
          {cabeceras.map((c, i) => <SelectItem key={i} value={String(i)}>{c}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={abierto} onOpenChange={(v) => { if (!v) reiniciar(); onOpenChange(v); }}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar precios desde Excel o CSV</DialogTitle>
          <DialogDescription>El archivo necesita una columna con el código (o el nombre) del producto y otra con el precio por unidad en USD. Puedes partir de "Exportar".</DialogDescription>
        </DialogHeader>

        {!archivo ? (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 text-sm text-muted-foreground hover:bg-muted/40" data-testid="importar-archivo">
            {leyendo ? <Loader2 className="h-6 w-6 animate-spin" /> : <FileUp className="h-6 w-6" />}
            <span>Elige un archivo .xlsx, .xls o .csv</span>
            <input type="file" accept=".xlsx,.xls,.csv,text/csv" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) leerArchivo(f); e.target.value = ""; }} />
          </label>
        ) : (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">{archivo}</span>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={reiniciar}>Cambiar archivo</Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.keys(hojas).length > 1 && (
                <div className="space-y-1">
                  <Label htmlFor="imp-hoja" className="text-xs">Hoja</Label>
                  <Select value={hoja} onValueChange={(v) => elegirHoja(v)}>
                    <SelectTrigger id="imp-hoja" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.keys(hojas).map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              {selectorColumna("imp-codigo", "Código / SKU", colCodigo, setColCodigo, true)}
              {selectorColumna("imp-nombre", "Nombre del producto", colNombre, setColNombre, true)}
              {selectorColumna("imp-precio", "Precio (USD por unidad)", colPrecio, setColPrecio)}
            </div>

            {filas.length > 0 && (
              <>
                <div className="flex flex-wrap gap-1.5" data-testid="importar-conteo">
                  {(Object.keys(ETIQUETA) as Estado[]).filter((e) => conteo[e]).map((e) => (
                    <Badge key={e} variant="outline" className={cn("px-1.5 py-0 text-[11px]", TONO[e])}>{ETIQUETA[e]}: {conteo[e]}</Badge>
                  ))}
                  <Button variant="link" size="sm" className="ml-auto h-auto p-0 text-xs" onClick={() => setVerTodo(!verTodo)}>
                    {verTodo ? "Ver solo cambios y problemas" : `Ver las ${filas.length} filas`}
                  </Button>
                </div>
                <div className="rounded-md border border-border">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead className="w-12">Fila</TableHead><TableHead>En el archivo</TableHead><TableHead>Producto en GUDS</TableHead>
                      <TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Nuevo</TableHead><TableHead>Estado</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {visibles.slice(0, 300).map((f) => (
                        <TableRow key={f.n}>
                          <TableCell className="text-xs text-muted-foreground">{f.n}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs" title={[f.codigo, f.nombre].filter(Boolean).join(" · ")}>{[f.codigo, f.nombre].filter(Boolean).join(" · ")}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs" title={f.producto?.nombre}>
                            {f.producto ? <>{f.producto.nombre}{f.por === "nombre" && <span className="ml-1 text-muted-foreground">(por nombre)</span>}</> : "—"}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">{f.antes == null ? "—" : fmtUsd(f.antes)}</TableCell>
                          <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">{f.precio == null ? (f.precioTxt || "—") : fmtUsd(f.precio)}</TableCell>
                          <TableCell><Badge variant="outline" className={cn("whitespace-nowrap px-1.5 py-0 text-[10px]", TONO[f.estado])}>{ETIQUETA[f.estado]}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {visibles.length > 300 && <p className="p-2 text-center text-xs text-muted-foreground">Se muestran 300 de {visibles.length} filas.</p>}
                </div>
              </>
            )}
            {filas.length === 0 && <p className="text-xs text-muted-foreground">Elige la columna del precio y la del código o el nombre.</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!aplicables.length || guardando} onClick={confirmar} data-testid="importar-confirmar">
            {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar {aplicables.length} precio{aplicables.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
