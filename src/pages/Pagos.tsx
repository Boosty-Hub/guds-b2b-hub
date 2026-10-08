import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { CheckCircle, XCircle, Loader2, Eye } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";
import { usePagination } from "@/hooks/use-pagination";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { OdooBadge } from "@/components/OdooBadge";
import { KpiStrip } from "@/components/datos/KpiStrip";
import { BarraLista } from "@/components/datos/BarraLista";
import { useOrdenTabla, EncabezadoOrdenable, exportarCSV, BotonExportar } from "@/components/datos/tabla";
import { useColumnas } from "@/components/datos/columnas";
import { VerificarCobroDialog } from "@/components/vendedor/VerificarCobroDialog";
import { urlComprobante } from "@/components/vendedor/comprobantes";
import { AnularCobroBoton } from "@/components/cobros/AnularCobroBoton";
import {
  FiltrosLista, useFiltros, useFiltroEmpresa, opcionesDe, opcionesPrueba, pasaPrueba, coincide, enRango, contadorFiltrado, type OpcionPrueba,
} from "@/components/datos/FiltrosLista";

interface PagoAdmin {
  odoo_id?: number | null;
  es_igtf?: boolean;
  igtf_origen?: { numero: string } | null;
  id: string;
  numero: string;
  monto: number;
  metodo: string;
  referencia: string | null;
  comprobante_url: string | null;
  banco: string | null;
  estado: "pendiente" | "verificado" | "rechazado" | "anulado";
  notas: string | null;
  motivo_anulacion?: string | null;
  monto_moneda?: number | null;
  created_at: string;
  fecha_verificacion: string | null;
  fecha_pago: string;
  orden?: { numero: string; total: number } | null;
  cliente?: { nombre_negocio: string } | null;
  cliente_id?: string | null;
  banco_id?: string | null;
  banco_ref?: { nombre: string } | null;
  moneda?: string | null;
  empresa_id?: string | null;
  // Cobros reportados por un vendedor (20o): se verifican con la propuesta de aplicación y la foto del comprobante
  registrado_por?: string | null;
  propuesta_estado?: string | null;
}

const estadoConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  verificado: { label: "Verificado", variant: "default" },
  rechazado: { label: "Rechazado", variant: "destructive" },
  anulado: { label: "Anulado", variant: "outline" },
};

const METODO: Record<string, string> = { transferencia: "Transferencia", efectivo: "Efectivo", pago_movil: "Pago móvil", tarjeta: "Tarjeta", credito: "Crédito" };

const Pagos = () => {
  const [pagos, setPagos] = useState<PagoAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [accion, setAccion] = useState<{ pago: PagoAdmin; aprobar: boolean } | null>(null);
  const [notas, setNotas] = useState("");
  const [procesando, setProcesando] = useState(false);
  const [verifCobro, setVerifCobro] = useState<string | null>(null);
  const { formatPrice } = useCurrency();
  const { toast } = useToast();

  useEffect(() => {
    fetchPagos();
  }, []);

  const fetchPagos = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pagos")
      .select(`
        id, numero, monto, monto_moneda, metodo, referencia, comprobante_url, banco, estado, notas, motivo_anulacion, created_at, fecha_verificacion, fecha_pago, odoo_id, es_igtf, igtf_origen:igtf_origen_id(numero),
        registrado_por, propuesta_estado, cliente_id, banco_id, moneda, empresa_id, banco_ref:bancos!pagos_banco_id_fkey(nombre),
        orden:ordenes(numero, total),
        cliente:clientes(nombre_negocio)
      `)
      .order("fecha_pago", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "No se pudieron cargar los pagos", description: error.message, variant: "destructive" });
    } else if (data) {
      setPagos(data as unknown as PagoAdmin[]);
    }
    setLoading(false);
  };

  const confirmarAccion = async () => {
    if (!accion) return;
    setProcesando(true);
    const { error } = await supabase.rpc("verificar_pago", {
      p_pago_id: accion.pago.id,
      p_aprobar: accion.aprobar,
      p_notas: notas || null,
    });
    setProcesando(false);

    if (error) {
      toast({ title: "No se pudo procesar el pago", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: accion.aprobar ? "Pago verificado" : "Pago rechazado",
      description: accion.aprobar
        ? `El pago ${accion.pago.numero} fue verificado y la orden marcada como pagada.`
        : `El pago ${accion.pago.numero} fue rechazado.`,
    });
    setAccion(null);
    setNotas("");
    fetchPagos();
  };

  // 'AAAA-MM-DD' (fecha del cobro) se lee como día local; un timestamp, tal cual
  const formatDate = (s: string) =>
    new Date(s.length === 10 ? `${s}T00:00:00` : s).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });

  // Los comprobantes de cobros de vendedor están en el bucket comprobantes-cobro (con prefijo); los demás, en documentos
  const verComprobante = async (path: string) => {
    try {
      window.open(await urlComprobante(path, 120), "_blank", "noopener,noreferrer");
    } catch (e) {
      toast({ title: "No se pudo abrir el comprobante", description: (e as Error).message, variant: "destructive" });
    }
  };

  // ---- Filtros (en la URL). Por defecto, los pagos por verificar (como antes) ----
  const pruebasEstado: OpcionPrueba<PagoAdmin>[] = [
    { valor: "pendiente", etiqueta: "Por verificar", prueba: (p) => p.estado === "pendiente" },
    { valor: "verificado", etiqueta: "Verificados", prueba: (p) => p.estado === "verificado" },
    { valor: "rechazado", etiqueta: "Rechazados", prueba: (p) => p.estado === "rechazado" },
    { valor: "anulado", etiqueta: "Anulados (en la Papelera)", prueba: (p) => p.estado === "anulado" },
    { valor: "todos", etiqueta: "Todos", prueba: () => true },
  ];
  const pruebasOrigen: OpcionPrueba<PagoAdmin>[] = [
    { valor: "odoo", etiqueta: "Odoo", prueba: (p) => !!p.odoo_id },
    { valor: "guds", etiqueta: "Registrado en GUDS", prueba: (p) => !p.odoo_id },
    { valor: "vendedor", etiqueta: "Reportado por un vendedor", prueba: (p) => !!p.registrado_por },
  ];
  const pruebasIgtf: OpcionPrueba<PagoAdmin>[] = [
    { valor: "si", etiqueta: "Solo IGTF", prueba: (p) => !!p.es_igtf }, { valor: "no", etiqueta: "Sin IGTF", prueba: (p) => !p.es_igtf },
  ];
  const filtroEmpresa = useFiltroEmpresa(pagos);
  const f = useFiltros([
    { clave: "estado", etiqueta: "Estado", principal: true, porDefecto: "pendiente", opciones: opcionesPrueba(pagos, pruebasEstado) },
    { clave: "fecha", etiqueta: "Fecha", tipo: "fecha", principal: true },
    { clave: "banco", etiqueta: "Banco", todos: "Todos los bancos", principal: true, opciones: opcionesDe(pagos, (p) => p.banco_id, (p) => p.banco_ref?.nombre ?? "—", "Sin banco") },
    { clave: "cliente", etiqueta: "Cliente", todos: "Todos los clientes", opciones: opcionesDe(pagos, (p) => p.cliente_id, (p) => p.cliente?.nombre_negocio ?? "—", "Sin cliente") },
    { clave: "metodo", etiqueta: "Método", todos: "Todos", opciones: opcionesDe(pagos, (p) => p.metodo, (_p, v) => METODO[v] ?? v) },
    { clave: "moneda", etiqueta: "Moneda", todos: "Todas", opciones: opcionesDe(pagos, (p) => p.moneda) },
    { clave: "origen", etiqueta: "Origen", todos: "Todos", opciones: opcionesPrueba(pagos, pruebasOrigen) },
    { clave: "igtf", etiqueta: "IGTF", todos: "Con y sin IGTF", opciones: opcionesPrueba(pagos, pruebasIgtf) },
    filtroEmpresa,
  ]);
  const filtro = f.v("estado");
  const texto = q.trim().toLowerCase();
  const visibles = pagos.filter((p) => pasaPrueba(pruebasEstado, filtro, p) && enRango(p.fecha_pago, f.v("fecha"))
    && coincide(p.banco_id, f.v("banco")) && coincide(p.cliente_id, f.v("cliente")) && coincide(p.metodo, f.v("metodo"))
    && coincide(p.moneda, f.v("moneda")) && pasaPrueba(pruebasOrigen, f.v("origen"), p) && pasaPrueba(pruebasIgtf, f.v("igtf"), p)
    && (!filtroEmpresa || coincide(p.empresa_id, f.v("empresa")))
    && (!texto || [p.numero, p.cliente?.nombre_negocio, p.referencia, p.orden?.numero, p.metodo].some((v) => (v || "").toLowerCase().includes(texto))));
  const { ordenadas, orden, alternar } = useOrdenTabla(visibles, {
    numero: (p) => p.numero, cliente: (p) => p.cliente?.nombre_negocio, orden: (p) => p.orden?.numero, monto: (p) => Number(p.monto || 0),
    metodo: (p) => p.metodo, referencia: (p) => p.referencia, fecha: (p) => p.fecha_pago, estado: (p) => p.estado,
  });
  const pagination = usePagination(ordenadas, 50, f.firma);
  const exportar = () => exportarCSV("cobros", ordenadas, [
    { titulo: "Pago", valor: (p) => p.numero }, { titulo: "Origen", valor: (p) => (p.odoo_id ? "Odoo" : "GUDS") },
    { titulo: "Cliente", valor: (p) => p.cliente?.nombre_negocio }, { titulo: "Orden", valor: (p) => p.orden?.numero },
    { titulo: "Monto USD", valor: (p) => Number(p.monto || 0) }, { titulo: "Método", valor: (p) => p.metodo }, { titulo: "Referencia", valor: (p) => p.referencia },
    { titulo: "Fecha", valor: (p) => p.fecha_pago }, { titulo: "Estado", valor: (p) => estadoConfig[p.estado]?.label || p.estado },
    { titulo: "IGTF", valor: (p) => (p.es_igtf ? "Sí" : "") }, { titulo: "Banco", valor: (p) => p.banco_ref?.nombre }, { titulo: "Moneda", valor: (p) => p.moneda },
  ]);
  const pendientes = pagos.filter((p) => p.estado === "pendiente");
  const montoPendiente = pendientes.reduce((s, p) => s + Number(p.monto || 0), 0);
  const verificados = pagos.filter((p) => p.estado === "verificado");
  const montoVerificado = verificados.reduce((s, p) => s + Number(p.monto || 0), 0);

  const cols = useColumnas("pagos", [{ etiqueta: "Pago", fija: true }, { etiqueta: "Cliente" }, { etiqueta: "Orden" }, { etiqueta: "Monto" }, { etiqueta: "Método" }, { etiqueta: "Referencia" }, { etiqueta: "Fecha" }, { etiqueta: "Estado" }, { etiqueta: "Acciones", fija: true }]);
  return (
    <MainLayout title="Verificación de Pagos">
      {cols.estilo}
      <KpiStrip
        items={[
          { label: "Pagos por verificar", valor: pendientes.length, tono: pendientes.length > 0 ? "alerta" : "normal",
            onClick: () => f.setVarios(Object.fromEntries(f.defs.map((d) => [d.clave, ""]))), activo: filtro === "pendiente" && f.activos === 0, titulo: "Ver solo los pagos por verificar" },
          { label: "Monto pendiente", valor: formatPrice(montoPendiente), tono: "alerta" },
          { label: "Verificado", valor: formatPrice(montoVerificado), detalle: `${verificados.length} pagos`, tono: "positivo" },
        ]}
      />

      <BarraLista
        busqueda={q}
        onBusqueda={setQ}
        placeholder="Buscar número, cliente, referencia u orden..."
        filtros={<FiltrosLista filtros={f} resultados={visibles.length} />}
        contador={loading ? undefined : contadorFiltrado(visibles.length, pagos.length, f.activos || !!texto)}
        acciones={<>{cols.selector}<BotonExportar onClick={exportar} total={ordenadas.length} /></>}
      />

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : visibles.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            {texto ? `Sin resultados para "${q.trim()}"` : f.activos ? "Ningún pago coincide con los filtros" : "No hay pagos pendientes de verificación"}
            {f.activos > 0 && <button type="button" className="ml-1 text-xs font-medium text-primary hover:underline" onClick={f.limpiar}>Limpiar filtros</button>}
          </div>
        ) : (
          <Table data-tabla="pagos">
            <TableHeader>
              <TableRow>
                <EncabezadoOrdenable clave="numero" orden={orden} onOrdenar={alternar}>Pago</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="cliente" orden={orden} onOrdenar={alternar}>Cliente</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="orden" orden={orden} onOrdenar={alternar}>Orden</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="monto" orden={orden} onOrdenar={alternar} alinear="derecha">Monto</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="metodo" orden={orden} onOrdenar={alternar}>Método</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="referencia" orden={orden} onOrdenar={alternar}>Referencia</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="fecha" orden={orden} onOrdenar={alternar}>Fecha</EncabezadoOrdenable>
                <EncabezadoOrdenable clave="estado" orden={orden} onOrdenar={alternar}>Estado</EncabezadoOrdenable>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagination.pageItems.map((pago) => (
                <TableRow key={pago.id}>
                  <TableCell className="whitespace-nowrap font-medium text-primary">
                    <span className="flex items-center gap-1.5">
                      {pago.numero}
                      {pago.odoo_id && <OdooBadge />}
                      {pago.es_igtf && <Badge variant="outline" className="px-1 py-0 text-[10px]">IGTF</Badge>}
                      {pago.registrado_por && <Badge variant="outline" className="px-1 py-0 text-[10px] font-normal" title="Reportado por el vendedor">Vendedor</Badge>}
                      {pago.propuesta_estado === "pendiente" && pago.estado === "pendiente" && (
                        <Badge variant="outline" className="border-sky-300 bg-sky-50 px-1 py-0 text-[10px] font-normal text-sky-900 dark:bg-sky-500/10 dark:text-sky-200" data-testid="badge-propuesta">Propuesta</Badge>
                      )}
                      {pago.igtf_origen && <span className="text-xs font-normal text-muted-foreground">IGTF del cobro {pago.igtf_origen.numero}</span>}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-[260px] truncate" title={pago.cliente?.nombre_negocio || undefined}>{pago.cliente?.nombre_negocio || "N/A"}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{pago.orden?.numero || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold">{formatPrice(pago.monto)}</TableCell>
                  <TableCell className="whitespace-nowrap capitalize">{pago.metodo?.replace("_", " ")}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <div className="flex items-center gap-1 whitespace-nowrap">
                      <span className="max-w-[160px] truncate" title={pago.referencia || undefined}>{pago.referencia || "—"}</span>
                      {pago.comprobante_url && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Ver comprobante"
                          onClick={() => verComprobante(pago.comprobante_url!)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(pago.fecha_pago)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={estadoConfig[pago.estado]?.variant || "secondary"}
                      className={pago.estado === "anulado" ? "text-muted-foreground line-through decoration-muted-foreground/50" : undefined}
                      title={pago.estado === "anulado" && pago.motivo_anulacion ? `Motivo: ${pago.motivo_anulacion}` : undefined}>
                      {estadoConfig[pago.estado]?.label || pago.estado}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    {pago.estado === "pendiente" ? (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-green-600 hover:bg-green-500/10 hover:text-green-700"
                          title="Verificar pago"
                          data-testid="verificar-pago"
                          onClick={() => { if (pago.registrado_por || pago.propuesta_estado) setVerifCobro(pago.id); else { setAccion({ pago, aprobar: true }); setNotas(""); } }}
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:bg-destructive/10"
                          title="Rechazar pago"
                          onClick={() => { setAccion({ pago, aprobar: false }); setNotas(""); }}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {pago.fecha_verificacion ? formatDate(pago.fecha_verificacion) : ""}
                        </span>
                        {pago.estado === "verificado" && (
                          <AnularCobroBoton variante="icono" onAnulado={fetchPagos}
                            cobro={{ id: pago.id, numero: pago.numero, monto: pago.monto, estado: pago.estado, odoo_id: pago.odoo_id, es_igtf: pago.es_igtf,
                              moneda: pago.moneda, monto_moneda: pago.monto_moneda, cliente: pago.cliente?.nombre_negocio }} />
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!loading && <DataTablePagination pagination={pagination} />}
      </div>

      {/* Cobro de vendedor: foto del comprobante y propuesta de aplicación a facturas (aplicar tal cual o corregir) */}
      <VerificarCobroDialog pagoId={verifCobro} onCerrar={() => setVerifCobro(null)} onHecho={() => { setVerifCobro(null); fetchPagos(); }} />

      {/* Diálogo de confirmación */}
      <Dialog open={!!accion} onOpenChange={(o) => { if (!o) { setAccion(null); setNotas(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {accion?.aprobar ? "Verificar pago" : "Rechazar pago"} {accion?.pago.numero}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm">
            <p className="text-muted-foreground">
              {accion?.aprobar
                ? `Confirmas que recibiste ${accion ? formatPrice(accion.pago.monto) : ""} del cliente ${accion?.pago.cliente?.nombre_negocio || ""}. La orden ${accion?.pago.orden?.numero || ""} quedará marcada como pagada.`
                : `Vas a rechazar el pago ${accion?.pago.numero} por ${accion ? formatPrice(accion.pago.monto) : ""}. Indica el motivo para que el cliente lo entienda.`}
            </p>
            <Textarea
              placeholder={accion?.aprobar ? "Notas (opcional)" : "Motivo del rechazo"}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAccion(null); setNotas(""); }} disabled={procesando}>
              Cancelar
            </Button>
            <Button
              variant={accion?.aprobar ? "default" : "destructive"}
              onClick={confirmarAccion}
              disabled={procesando || (!accion?.aprobar && !notas.trim())}
            >
              {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : accion?.aprobar ? "Verificar pago" : "Rechazar pago"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
};

export default Pagos;
