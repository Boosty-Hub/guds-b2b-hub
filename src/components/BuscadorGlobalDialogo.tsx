import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command as CommandPrimitive } from "cmdk";
import {
  Search, Users, UserRound, Truck, Package, ShoppingCart, FileText, FileMinus, FilePlus, HandCoins, FileInput, Wallet,
  ClipboardList, Receipt, Tag, ArrowLeftRight, Warehouse, Landmark, UserCog, CornerDownLeft, Clock, Loader2, LayoutGrid,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { navSections, accesosBuscador } from "@/components/layout/navegacion";
import { usePermissions } from "@/contexts/PermissionsContext";
import type { ModuloBuscador } from "@/components/BuscadorGlobal";

interface Resultado { tipo: string; id: string; titulo: string; subtitulo: string | null; extra: string | null; enlace: string; relevancia: number }

const TIPOS: Record<string, { label: string; icon: typeof Users }> = {
  cliente: { label: "Clientes", icon: Users },
  contacto: { label: "Contactos", icon: UserRound },
  proveedor: { label: "Proveedores", icon: Truck },
  producto: { label: "Productos", icon: Package },
  orden: { label: "Órdenes de venta", icon: ShoppingCart },
  factura: { label: "Facturas", icon: FileText },
  nota_credito: { label: "Notas de crédito", icon: FileMinus },
  nota_debito: { label: "Notas de débito", icon: FilePlus },
  cobro: { label: "Cobros", icon: HandCoins },
  factura_proveedor: { label: "Facturas de proveedor", icon: FileInput },
  pago_proveedor: { label: "Pagos a proveedores", icon: Wallet },
  orden_compra: { label: "Órdenes de compra", icon: ClipboardList },
  retencion: { label: "Retenciones recibidas", icon: Receipt },
  retencion_emitida: { label: "Retenciones emitidas", icon: Receipt },
  lote: { label: "Lotes y series", icon: Tag },
  transferencia: { label: "Transferencias", icon: ArrowLeftRight },
  almacen: { label: "Almacenes", icon: Warehouse },
  banco: { label: "Bancos", icon: Landmark },
  vendedor: { label: "Vendedores", icon: UserCog },
};
const ORDEN_TIPOS = Object.keys(TIPOS);
const CLAVE_RECIENTES = "guds.buscador.recientes";
const leerRecientes = (): Resultado[] => { try { return JSON.parse(localStorage.getItem(CLAVE_RECIENTES) || "[]"); } catch { return []; } };

/** Diálogo del buscador global (cmdk + Radix Dialog). Se descarga aparte al abrirlo por primera vez (o cuando el
 *  navegador queda libre): ver BuscadorGlobal, que tiene el botón y el atajo Ctrl/⌘ + K. */
export function BuscadorGlobalDialogo({ abierto, setAbierto, contexto = "admin", modulos: modulosPropios }: {
  abierto: boolean; setAbierto: (abierto: boolean) => void; contexto?: "admin" | "vendedor"; modulos?: ModuloBuscador[];
}) {
  const vendedor = contexto === "vendedor";
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState(false);
  const [recientes, setRecientes] = useState<Resultado[]>(leerRecientes);
  const [seleccion, setSeleccion] = useState("");
  const consulta = useRef(0);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setResultados([]); setCargando(false); return; }
    setCargando(true);
    const n = ++consulta.current;
    const h = setTimeout(async () => {
      const { data, error } = await supabase.rpc("buscar_global", { q: t, limite: 6, contexto });
      if (n !== consulta.current) return;
      setFallo(!!error);
      setResultados((data as Resultado[] | null) ?? []);
      setCargando(false);
    }, 150);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const modulos = useMemo(() => {
    const t = q.trim().toLowerCase();
    const todos: ModuloBuscador[] = modulosPropios
      ?? [...navSections.flatMap((s) => s.items.filter((i) => i.modulo === "dashboard" || can(i.modulo, "ver")).map((i) => ({ label: i.label, path: i.path, seccion: s.title }))),
        ...accesosBuscador.filter((a) => a.modulos.every((m) => can(m, "ver"))).map(({ label, path, seccion }) => ({ label, path, seccion }))];
    if (!t) return [];
    return todos.filter((m) => m.label.toLowerCase().includes(t) || m.seccion.toLowerCase().includes(t)).slice(0, 5);
  }, [q, can, modulosPropios]);

  const grupos = useMemo(() => {
    const m = new Map<string, Resultado[]>();
    for (const r of resultados) { if (!m.has(r.tipo)) m.set(r.tipo, []); m.get(r.tipo)!.push(r); }
    return [...m.entries()].sort((a, b) => {
      const ra = Math.max(...a[1].map((x) => x.relevancia)), rb = Math.max(...b[1].map((x) => x.relevancia));
      return rb - ra || ORDEN_TIPOS.indexOf(a[0]) - ORDEN_TIPOS.indexOf(b[0]);
    });
  }, [resultados]);

  // Al llegar resultados nuevos, Enter abre el primero (cmdk conserva la selección anterior aunque ya no exista)
  useEffect(() => {
    if (q.trim().length < 2) { setSeleccion(recientes[0] ? "reciente-" + recientes[0].tipo + recientes[0].id : ""); return; }
    const primero = modulos[0] ? "modulo-" + modulos[0].path : grupos[0] ? grupos[0][0] + grupos[0][1][0].id : "";
    setSeleccion(primero);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos, modulos]);

  const ir = useCallback((r: Resultado) => {
    const nuevos = [r, ...leerRecientes().filter((x) => !(x.tipo === r.tipo && x.id === r.id))].slice(0, 8);
    try { localStorage.setItem(CLAVE_RECIENTES, JSON.stringify(nuevos)); } catch { /* sin almacenamiento */ }
    setRecientes(nuevos);
    setAbierto(false);
    setQ("");
    navigate(r.enlace);
  }, [navigate, setAbierto]);

  const fila = (r: Resultado, prefijo = "") => {
    const T = TIPOS[r.tipo] ?? { label: r.tipo, icon: Search };
    return (
      <CommandPrimitive.Item key={prefijo + r.tipo + r.id} value={prefijo + r.tipo + r.id} onSelect={() => ir(r)}
        className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] aria-selected:bg-primary/10 aria-selected:text-foreground">
        <T.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{r.titulo}</span>
          {r.subtitulo && <span className="block truncate text-[11px] text-muted-foreground">{r.subtitulo}</span>}
        </span>
        {r.extra && <span className="shrink-0 text-xs font-semibold tabular-nums">{r.extra}</span>}
        {prefijo && <span className="shrink-0 text-[10px] uppercase text-muted-foreground">{T.label}</span>}
      </CommandPrimitive.Item>
    );
  };

  return (
    <>
      <Dialog open={abierto} onOpenChange={(o) => { setAbierto(o); if (!o) setQ(""); }}>
        <DialogContent className="top-[12%] max-w-2xl translate-y-0 gap-0 overflow-hidden p-0 [&>button]:hidden">
          <DialogTitle className="sr-only">Buscador global</DialogTitle>
          <CommandPrimitive shouldFilter={false} loop value={seleccion} onValueChange={setSeleccion} className="flex flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <CommandPrimitive.Input value={q} onValueChange={setQ} autoFocus placeholder={vendedor ? "Buscar tus clientes, pedidos, facturas, cobros o productos…" : "Buscar en toda la base: nombre, RIF, número de orden, factura, lote, referencia…"}
                className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              {cargando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <CommandPrimitive.List className="max-h-[60vh] overflow-y-auto p-1.5">
              {q.trim().length < 2 ? (
                recientes.length > 0 ? (
                  <CommandPrimitive.Group heading="Recientes" className="[&_[cmdk-group-heading]]:flex [&_[cmdk-group-heading]]:items-center [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-muted-foreground">
                    {recientes.map((r) => fila(r, "reciente-"))}
                  </CommandPrimitive.Group>
                ) : (
                  <p className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground"><Clock className="h-4 w-4 shrink-0" /> {vendedor ? "Escribe al menos 2 letras. Busca en tus clientes, sus pedidos, facturas y cobros, y en los productos." : "Escribe al menos 2 letras. Busca en clientes, contactos, proveedores, productos, órdenes, facturas, cobros, compras, retenciones, lotes, transferencias, almacenes, bancos y vendedores."}</p>
                )
              ) : (
                <>
                  {modulos.length > 0 && (
                    <CommandPrimitive.Group heading="Ir a" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-muted-foreground">
                      {modulos.map((m) => (
                        <CommandPrimitive.Item key={m.path} value={"modulo-" + m.path} onSelect={() => { setAbierto(false); setQ(""); navigate(m.path); }}
                          className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] aria-selected:bg-primary/10">
                          <LayoutGrid className="h-4 w-4 text-muted-foreground" /><span className="flex-1">{m.label}</span>
                          <span className="text-[10px] uppercase text-muted-foreground">{m.seccion}</span>
                        </CommandPrimitive.Item>
                      ))}
                    </CommandPrimitive.Group>
                  )}
                  {grupos.map(([tipo, items]) => (
                    <CommandPrimitive.Group key={tipo} heading={`${TIPOS[tipo]?.label ?? tipo} (${items.length})`}
                      className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-0.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-muted-foreground">
                      {items.map((r) => fila(r))}
                    </CommandPrimitive.Group>
                  ))}
                  {!cargando && grupos.length === 0 && modulos.length === 0 && (
                    <p className="px-3 py-6 text-center text-sm text-muted-foreground">{fallo ? "La búsqueda no respondió a tiempo. Vuelve a intentarlo en unos segundos." : <>Sin resultados para “{q.trim()}”.</>}</p>
                  )}
                </>
              )}
            </CommandPrimitive.List>
            <div className="flex items-center gap-3 border-t border-border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><CornerDownLeft className="h-3 w-3" /> abrir</span>
              <span>↑↓ moverse</span><span>Esc cerrar</span>
              <span className="ml-auto">{resultados.length > 0 && `${resultados.length} resultados`}</span>
            </div>
          </CommandPrimitive>
        </DialogContent>
      </Dialog>
    </>
  );
}
