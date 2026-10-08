import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Loader2 } from "lucide-react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/lib/supabase";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { BotonExcel } from "@/components/datos/BotonExcel";
import { useOrdenTabla, EncabezadoOrdenable } from "@/components/datos/tabla";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesTexto, opcionesPrueba, pasaPrueba, coincide, coincideTexto, enRango,
  contadorFiltrado, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { fmtUsd } from "@/components/estado-cuenta/formato";
import { fechaDMA, hoyCaracas } from "@/lib/fechas";
import { nombreArchivoExcel } from "@/lib/excel";
import { ESTADO_NOTA, SERIE_NOTA, abierta, type NotaEntrega } from "@/components/notas-entrega/tipos";

// Finanzas → Notas de entrega (22g · NE1): las notas de entrega NO fiscales, deuda interna que no está en Odoo. Solo
// consulta por ahora (las históricas del Excel de finanzas); emitir, abonar y convertir llegan en NE2–NE3.

const NotasEntrega = () => {
  const navigate = useNavigate();
  const { empresas, empresaActiva, soloLectura } = useEmpresa();
  const [notas, setNotas] = useState<NotaEntrega[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error: e } = await supabase.from("v_notas_entrega").select("*").order("fecha_emision", { ascending: false }).limit(10000);
      if (e) setError(e.message);
      setNotas((data as NotaEntrega[]) ?? []);
      setLoading(false);
    })();
  }, [empresaActiva?.id, soloLectura]);

  const pruebasEstado: OpcionPrueba<NotaEntrega>[] = [
    { valor: "abiertas", etiqueta: "Con saldo", prueba: abierta },
    { valor: "activas", etiqueta: "Con saldo · deuda activa", prueba: (x) => abierta(x) && x.clasificacion === "activa" },
    { valor: "incobrables", etiqueta: "Con saldo · incobrables", prueba: (x) => abierta(x) && x.clasificacion === "incobrable" },
    { valor: "cerradas", etiqueta: "Pagadas, facturadas o devueltas", prueba: (x) => ["pagada", "facturada", "devuelta"].includes(x.estado) },
    { valor: "anuladas", etiqueta: "Anuladas", prueba: (x) => x.estado === "anulada" },
    { valor: "todas", etiqueta: "Todas", prueba: () => true },
  ];
  const pruebasFicha: OpcionPrueba<NotaEntrega>[] = [
    { valor: "con", etiqueta: "Con ficha en GUDS", prueba: (x) => !!x.cliente_id },
    { valor: "sin", etiqueta: "Sin ficha (solo el nombre)", prueba: (x) => !x.cliente_id },
  ];
  const filtroEmpresa = useFiltroEmpresa(notas);
  const f = useFiltros([
    { clave: "estado", etiqueta: "Estado", principal: true, porDefecto: "abiertas", opciones: opcionesPrueba(notas, pruebasEstado) },
    { clave: "fecha", etiqueta: "Emisión", tipo: "fecha", principal: true },
    { clave: "vendedor", etiqueta: "Vendedor", principal: true, opciones: opcionesTexto(notas, (x) => x.vendedor, "Sin vendedor") },
    { clave: "ficha", etiqueta: "Cliente en GUDS", todos: "Con y sin ficha", opciones: opcionesPrueba(notas, pruebasFicha) },
    { clave: "serie", etiqueta: "Serie", todos: "Todas", opciones: opcionesDe(notas, (x) => x.serie, (x) => SERIE_NOTA[x.serie]) },
    filtroEmpresa,
  ]);

  const filtradas = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notas.filter((x) =>
      pasaPrueba(pruebasEstado, f.v("estado"), x) && enRango(x.fecha_emision, f.v("fecha")) && coincideTexto(x.vendedor, f.v("vendedor"))
      && pasaPrueba(pruebasFicha, f.v("ficha"), x) && coincide(x.serie, f.v("serie"))
      && (!filtroEmpresa || coincide(x.empresa_id, f.v("empresa")))
      && (!q || `${x.documento} ${x.cliente} ${x.rif ?? ""} ${x.vendedor ?? ""} ${x.observacion ?? ""}`.toLowerCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notas, search, f.firma]);

  const { ordenadas, orden, alternar } = useOrdenTabla(filtradas, {
    numero: (x) => Number(x.numero) || x.numero, cliente: (x) => x.cliente, vendedor: (x) => x.vendedor, emision: (x) => x.fecha_emision,
    total: (x) => Number(x.total_usd), saldo: (x) => Number(x.saldo_usd),
  });
  const pagination = usePagination(ordenadas, 50, f.firma);

  const kpi = useMemo(() => {
    const ab = notas.filter(abierta);
    const suma = (xs: NotaEntrega[]) => xs.reduce((s, x) => s + Number(x.saldo_usd), 0);
    const hoy = hoyCaracas();
    return {
      activo: suma(ab.filter((x) => x.clasificacion === "activa")), incobrable: suma(ab.filter((x) => x.clasificacion === "incobrable")),
      abiertas: ab.length, clientes: new Set(ab.map((x) => x.cliente_id ?? x.cliente)).size, sinFicha: ab.filter((x) => !x.cliente_id).length,
      mes: notas.filter((x) => x.fecha_emision.slice(0, 7) === hoy.slice(0, 7) && x.estado !== "anulada").length,
    };
  }, [notas]);
  const nombreEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nombre_corto ?? "";
  const textoEmpresas = empresaActiva?.nombre_corto ?? empresas.map((e) => e.nombre_corto).join(" y ");

  const libro = () => ({
    archivo: nombreArchivoExcel("notas de entrega", textoEmpresas, hoyCaracas()),
    hojas: [{
      nombre: "Notas de entrega",
      encabezado: ["Notas de entrega no fiscales", `Empresas: ${textoEmpresas}`, `Al ${fechaDMA(hoyCaracas())} · deuda interna que no está en Odoo`],
      totales: "Totales",
      columnas: [
        ...(soloLectura ? [{ titulo: "Empresa", valor: (x: NotaEntrega) => nombreEmpresa(x.empresa_id), ancho: 11 }] : []),
        { titulo: "Documento", valor: (x: NotaEntrega) => x.documento },
        { titulo: "Cliente", valor: (x: NotaEntrega) => x.cliente, ancho: 40 },
        { titulo: "RIF", valor: (x: NotaEntrega) => x.rif ?? "" },
        { titulo: "Ficha en GUDS", valor: (x: NotaEntrega) => (x.cliente_id ? "Sí" : "No"), ancho: 8 },
        { titulo: "Vendedor", valor: (x: NotaEntrega) => x.vendedor ?? "", ancho: 22 },
        { titulo: "Emisión", valor: (x: NotaEntrega) => x.fecha_emision, tipo: "fecha" as const },
        { titulo: "Total USD (sin IVA)", valor: (x: NotaEntrega) => Number(x.total_usd), tipo: "usd" as const },
        { titulo: "Abonado USD", valor: (x: NotaEntrega) => Number(x.abonado), tipo: "usd" as const },
        { titulo: "Saldo USD", valor: (x: NotaEntrega) => Number(x.saldo_usd), tipo: "usd" as const },
        { titulo: "Clasificación", valor: (x: NotaEntrega) => (x.clasificacion === "incobrable" ? "Incobrable" : "Deuda activa"), ancho: 13 },
        { titulo: "Estado", valor: (x: NotaEntrega) => ESTADO_NOTA[x.estado].texto, ancho: 11 },
        { titulo: "Observación", valor: (x: NotaEntrega) => x.observacion ?? "", ancho: 50, ajustar: true },
      ],
      filas: ordenadas,
    }],
  });

  return (
    <MainLayout title="Notas de entrega">
      <KpiStrip items={[
        { label: "Saldo activo", valor: fmtUsd(kpi.activo), tono: "primario", titulo: "Notas con saldo marcadas como deuda activa" },
        { label: "Incobrable", valor: fmtUsd(kpi.incobrable), tono: kpi.incobrable > 0.009 ? "negativo" : "tenue" },
        { label: "Con saldo", valor: kpi.abiertas.toLocaleString("es-VE"), detalle: `${kpi.clientes} clientes` },
        { label: "Sin ficha en GUDS", valor: kpi.sinFicha.toLocaleString("es-VE"), tono: kpi.sinFicha ? "alerta" : "tenue",
          titulo: "Clientes que no existen en Odoo: se guarda solo su nombre (crear el cliente lo crearía en Odoo)" },
        { label: "Emitidas en el mes", valor: kpi.mes.toLocaleString("es-VE"), tono: "tenue" },
      ]} />
      <p className="-mt-1 mb-2 text-xs text-muted-foreground" data-testid="ne-aviso">
        Documentos no fiscales: deuda interna que no está en Odoo ni en el estado de cuenta del cliente. Por ahora solo consulta:
        las históricas se cargaron del Excel de finanzas; emitir, abonar y convertir en factura llegarán con la definición de finanzas.
      </p>

      <BarraLista
        busqueda={search}
        onBusqueda={setSearch}
        placeholder="Buscar por número, cliente o vendedor..."
        filtros={<FiltrosLista filtros={f} resultados={filtradas.length} />}
        contador={loading ? undefined : contadorFiltrado(filtradas.length, notas.length, f.activos || !!search)}
        acciones={<BotonExcel libro={libro} disabled={loading || !ordenadas.length} size="sm" className="h-8 gap-1.5" data-testid="ne-excel" />}
      />

      <div className="rounded-lg border border-border bg-card">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : error ? (
          <p className="p-4 text-sm text-destructive" data-testid="ne-error">No se pudieron cargar las notas de entrega: {error}</p>
        ) : filtradas.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-muted-foreground">
            <ClipboardList className="mb-2 h-8 w-8 opacity-50" />
            {notas.length > 0 ? "Ninguna nota de entrega coincide con la búsqueda o los filtros" : "No hay notas de entrega"}
            {f.activos > 0 && <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={f.limpiar}>Limpiar filtros</button>}
          </div>
        ) : (
          <Table data-tabla="notas-entrega" data-testid="ne-tabla">
            <TableHeader>
              <TableRow>
                <EncabezadoOrdenable clave="numero" orden={orden} onOrdenar={alternar}>Nº</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="cliente" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="vendedor" orden={orden} onOrdenar={alternar} className="hidden lg:table-cell">Vendedor</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="emision" orden={orden} onOrdenar={alternar} className="hidden sm:table-cell">Emisión</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="total" orden={orden} onOrdenar={alternar} alinear="derecha" className="hidden md:table-cell">Total</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="saldo" orden={orden} onOrdenar={alternar} alinear="derecha">Saldo</EncabezadoOrdenable>
                <TableHead className="hidden sm:table-cell">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.pageItems.map((x) => (
                <TableRow key={x.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/notas-entrega/${x.id}`)} data-testid="ne-fila">
                  <TableCell className="whitespace-nowrap font-mono text-xs text-primary">{x.documento}</TableCell>
                  <TableCell className="max-w-[200px] sm:max-w-[300px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium" title={x.cliente}>{x.cliente}</span>
                      {!x.cliente_id && <Badge variant="outline" className="h-4 shrink-0 px-1 text-[10px]" title="No tiene ficha en GUDS (no está en Odoo)">Sin ficha</Badge>}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {/* En el celular van también la fecha y la marca de incobrable (sus columnas se ocultan) */}
                      <span className="sm:hidden">{[fechaDMA(x.fecha_emision), soloLectura ? nombreEmpresa(x.empresa_id) : null, x.rif].filter(Boolean).join(" · ")}</span>
                      <span className="hidden sm:inline">{[soloLectura ? nombreEmpresa(x.empresa_id) : null, x.rif].filter(Boolean).join(" · ")}</span>
                      {x.clasificacion === "incobrable" && <span className="text-destructive sm:hidden"> · Incobrable</span>}
                    </span>
                  </TableCell>
                  <TableCell className="hidden max-w-[180px] truncate lg:table-cell">{x.vendedor ?? "—"}</TableCell>
                  <TableCell className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{fechaDMA(x.fecha_emision)}</TableCell>
                  <TableCell className="hidden whitespace-nowrap text-right tabular-nums md:table-cell">{fmtUsd(x.total_usd)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{fmtUsd(x.saldo_usd)}</TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">
                    <span className="flex gap-1">
                      <Badge variant={ESTADO_NOTA[x.estado].variant}>{ESTADO_NOTA[x.estado].texto}</Badge>
                      {x.clasificacion === "incobrable" && <Badge variant="destructive">Incobrable</Badge>}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!loading && !error && <DataTablePagination pagination={pagination} />}
      </div>
    </MainLayout>
  );
};

export default NotasEntrega;
