import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { VendedorLayout } from "@/components/vendedor/VendedorLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, MessageCircle, Phone } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable } from "@/components/datos/tabla";
import { useResumenVendedor } from "@/components/vendedor/resumen";
import { AvisoEmpresaCartera } from "@/components/vendedor/AvisoEmpresaCartera";
import { enlaceWhatsApp, telefonoLlamar, telefonoWhatsApp } from "@/components/vendedor/contacto";
import { estadoVe } from "@/components/clientes/odooCliente";
import {
  FiltrosLista, useFiltros, opcionesDe, opcionesTexto, opcionesPrueba, pasaPrueba, coincide, coincideTexto, contadorFiltrado,
  type OpcionPrueba,
} from "@/components/datos/FiltrosLista";

interface Cli {
  id: string; codigo: string; nombre_negocio: string; ciudad: string;
  telefono: string | null; limite_credito: number; estado: string | null; condicion_pago: string | null;
  saldo: number; aFavor: number; vencido: number; diasMora: number;
}

/** "15 Days" / "Immediate Payment" (como vienen de Odoo) → "15 días" / "Pago inmediato". */
const textoCondicion = (c: string) => c.replace(/^Immediate Payment$/i, "Pago inmediato").replace(/^(\d+)\s*Days?$/i, "$1 días").replace(/^contado$/i, "Contado");

// Situación de cobro con las mismas reglas que la insignia "Estado" de la tabla
const conDeuda = (c: Cli) => Number(c.saldo || 0) > 0.009;
const excedido = (c: Cli) => Number(c.limite_credito) > 0 && Number(c.saldo || 0) > Number(c.limite_credito);
const SITUACION: OpcionPrueba<Cli>[] = [
  { valor: "con", etiqueta: "Con saldo pendiente", prueba: conDeuda },
  { valor: "vencido", etiqueta: "Con vencido", prueba: (c) => c.vencido > 0.009 },
  { valor: "por_vencer", etiqueta: "Solo por vencer", prueba: (c) => conDeuda(c) && c.vencido <= 0.009 },
  { valor: "excedido", etiqueta: "Sobre su límite", prueba: excedido },
  { valor: "a_favor", etiqueta: "Con saldo a favor", prueba: (c) => c.aFavor < -0.009 },
  { valor: "al_dia", etiqueta: "Al día (sin saldo)", prueba: (c) => !conDeuda(c) },
];

const VendedorClientes = () => {
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [lista, setLista] = useState<Omit<Cli, "saldo" | "aFavor" | "vencido" | "diasMora">[]>([]);
  const [loading, setLoading] = useState(true);
  // Deuda por cliente y totales desde resumen_vendedor() (misma definición que el Dashboard y Cuentas por cobrar)
  const { resumen, cargando: cargandoResumen } = useResumenVendedor(true);
  const [search, setSearch] = useState(params.get("q") || "");
  // El buscador global abre esta página con ?q=
  useEffect(() => { const q = params.get("q"); if (q !== null) setSearch(q); }, [params]);

  const fetchClientes = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    // Solo los clientes asignados a este vendedor
    const { data } = await supabase
      .from("clientes")
      .select("id, codigo, nombre_negocio, ciudad, telefono, limite_credito, estado, condicion_pago")
      .eq("activo", true)
      .eq("vendedor_asignado_id", user.id)
      .order("nombre_negocio");
    setLista((data ?? []) as Omit<Cli, "saldo" | "aFavor" | "vencido" | "diasMora">[]);
    setLoading(false);
  }, [user?.id]);
  useEffect(() => { fetchClientes(); }, [fetchClientes]);

  const clientes: Cli[] = useMemo(() => {
    const deuda = new Map((resumen?.detalle ?? []).map((d) => [d.cliente_id, d]));
    return lista.map((c) => {
      const d = deuda.get(c.id);
      return { ...c, saldo: Number(d?.por_cobrar ?? 0), aFavor: Number(d?.a_favor ?? 0), vencido: Number(d?.vencido ?? 0), diasMora: Number(d?.dias_mora ?? 0) };
    });
  }, [lista, resumen]);
  const cartera = resumen?.cartera;

  // ---- Filtros (en la URL: ?situacion=&ciudad=&estado=&condicion=) ----
  const f = useFiltros([
    { clave: "situacion", etiqueta: "Situación", todos: "Todas", principal: true, opciones: opcionesPrueba(clientes, SITUACION) },
    { clave: "ciudad", etiqueta: "Ciudad", todos: "Todas las ciudades", opciones: opcionesTexto(clientes, (c) => c.ciudad, "Sin ciudad") },
    { clave: "estado", etiqueta: "Estado", todos: "Todos los estados", opciones: opcionesDe(clientes, (c) => estadoVe(c.estado) ?? c.estado, undefined, "Sin estado") },
    { clave: "condicion", etiqueta: "Condición de pago", todos: "Todas", opciones: opcionesDe(clientes, (c) => c.condicion_pago, (_c, v) => textoCondicion(v), "Sin condición") },
  ]);
  const situacion = f.v("situacion");
  const texto = search.trim().toLowerCase();
  const filtrados = clientes.filter((c) =>
    pasaPrueba(SITUACION, situacion, c) && coincideTexto(c.ciudad, f.v("ciudad"))
    && coincide(estadoVe(c.estado) ?? c.estado, f.v("estado")) && coincide(c.condicion_pago, f.v("condicion")) &&
    (!texto || c.nombre_negocio.toLowerCase().includes(texto) || (c.codigo || "").toLowerCase().includes(texto) || (c.ciudad || "").toLowerCase().includes(texto)));
  const { ordenadas, orden, alternar } = useOrdenTabla(filtrados, {
    nombre: (c) => c.nombre_negocio, ciudad: (c) => c.ciudad, limite: (c) => Number(c.limite_credito || 0), saldo: (c) => Number(c.saldo || 0),
  });
  const pagination = usePagination(ordenadas, 50, f.firma);
  // Los indicadores de situación fijan el filtro (o lo quitan si ya estaba)
  const verSituacion = (v: string) => () => f.set("situacion", situacion === v ? "" : v);

  return (
    <VendedorLayout title="Mis Clientes">
      {resumen && <AvisoEmpresaCartera clientes={resumen.clientes} porEmpresa={resumen.clientes_por_empresa} />}
      <KpiStrip items={[
        { label: "Clientes asignados", valor: resumen?.clientes ?? "—", tono: "primario", onClick: () => f.set("situacion", ""), activo: !situacion },
        { label: "Con saldo pendiente", valor: cartera?.clientes_con_saldo ?? "—", tono: cartera?.clientes_con_saldo ? "alerta" : "normal", onClick: verSituacion("con"), activo: situacion === "con" },
        { label: "Por cobrar", valor: cartera ? formatPrice(cartera.por_cobrar) : "—", detalle: cartera && cartera.vencido > 0.009 ? `${formatPrice(cartera.vencido)} vencido` : undefined,
          tono: cartera && cartera.por_cobrar > 0.009 ? "negativo" : "normal",
          titulo: cartera && cartera.a_favor < -0.009 ? `Neto ${formatPrice(cartera.neto)} (saldo a favor de clientes: ${formatPrice(Math.abs(cartera.a_favor))})` : undefined },
        { label: "Sobre su límite", valor: cartera?.clientes_excedidos ?? "—", tono: cartera?.clientes_excedidos ? "negativo" : "normal", onClick: verSituacion("excedido"), activo: situacion === "excedido" },
      ]} />

      <BarraLista busqueda={search} onBusqueda={setSearch} placeholder="Buscar cliente, código o ciudad..."
        filtros={<FiltrosLista filtros={f} resultados={filtrados.length} />}
        contador={loading ? undefined : contadorFiltrado(filtrados.length, clientes.length, f.activos || !!texto)} />

      <div className="rounded-lg border border-border bg-card">
        {loading || cargandoResumen ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></div>
        ) : filtrados.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {clientes.length ? `Sin resultados${texto ? ` para "${search.trim()}"` : ""}` : "No tienes clientes asignados"}
            {clientes.length > 0 && f.activos > 0 && <button type="button" className="ml-2 font-medium text-primary hover:underline" onClick={f.limpiar}>Limpiar filtros</button>}
          </div>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <EncabezadoOrdenable clave="nombre" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable>
              <TableHead className="hidden sm:table-cell">Código</TableHead>
              <EncabezadoOrdenable clave="ciudad" orden={orden} onOrdenar={alternar} className="hidden md:table-cell">Ciudad</EncabezadoOrdenable>
              <EncabezadoOrdenable clave="limite" orden={orden} onOrdenar={alternar} alinear="derecha" className="hidden md:table-cell">Línea de crédito</EncabezadoOrdenable>
              <EncabezadoOrdenable clave="saldo" orden={orden} onOrdenar={alternar} alinear="derecha">Por cobrar</EncabezadoOrdenable>
              <TableHead>Estado</TableHead><TableHead className="text-right">Contacto</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {pagination.pageItems.map((c) => {
                const saldo = Number(c.saldo || 0);
                const esExcedido = excedido(c);
                const debe = conDeuda(c);
                const vencido = c.vencido > 0.009;
                const aFavor = !debe && c.aFavor < -0.009;
                return (
                  <TableRow key={c.id} className="cursor-pointer" onClick={() => navigate(`/vendedor/clientes/${c.id}`)} data-testid="cliente-fila">
                    <TableCell className="font-medium">
                      <Link to={`/vendedor/clientes/${c.id}`} onClick={(e) => e.stopPropagation()} className="block max-w-[280px] truncate hover:underline" title={c.nombre_negocio}>{c.nombre_negocio}</Link>
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap font-mono text-xs text-muted-foreground sm:table-cell">{c.codigo}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-muted-foreground md:table-cell">{c.ciudad}</TableCell>
                    <TableCell className="hidden whitespace-nowrap text-right md:table-cell">{Number(c.limite_credito) > 0 ? formatPrice(Number(c.limite_credito)) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className={`whitespace-nowrap text-right font-semibold ${debe ? "text-destructive" : ""}`}>
                      {formatPrice(saldo)}
                      {c.aFavor < -0.009 && <span className="block text-[11px] font-normal text-emerald-700 dark:text-emerald-400">{formatPrice(Math.abs(c.aFavor))} a favor</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {esExcedido ? <Badge variant="destructive">Excedido</Badge>
                        : vencido ? <Badge variant="outline" className="border-red-300 bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300" title={`Mora máx. ${c.diasMora} días`}>Vencido · {c.diasMora} d</Badge>
                        : debe ? <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Por vencer</Badge>
                        : aFavor ? <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">Saldo a favor</Badge>
                        : <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-300">Al día</Badge>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                      {c.telefono ? (
                        <span className="inline-flex">
                          <Button asChild size="icon" variant="ghost" className="h-7 w-7" title={`Llamar ${c.telefono}`}><a href={`tel:${telefonoLlamar(c.telefono)}`}><Phone className="h-3.5 w-3.5" /></a></Button>
                          {telefonoWhatsApp(c.telefono) && (
                            <Button asChild size="icon" variant="ghost" className="h-7 w-7" title="WhatsApp">
                              <a href={enlaceWhatsApp(c.telefono, `Hola, ${c.nombre_negocio}. `)} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-3.5 w-3.5" /></a>
                            </Button>
                          )}
                        </span>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {!loading && filtrados.length > 0 && <DataTablePagination pagination={pagination} />}
      </div>
    </VendedorLayout>
  );
};

export default VendedorClientes;
