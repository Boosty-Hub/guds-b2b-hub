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
  estado: "pendiente" | "verificado" | "rechazado";
  notas: string | null;
  created_at: string;
  fecha_verificacion: string | null;
  orden?: { numero: string; total: number } | null;
  cliente?: { nombre_negocio: string } | null;
}

const estadoConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pendiente: { label: "Pendiente", variant: "secondary" },
  verificado: { label: "Verificado", variant: "default" },
  rechazado: { label: "Rechazado", variant: "destructive" },
};

const Pagos = () => {
  const [pagos, setPagos] = useState<PagoAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<"pendiente" | "todos">("pendiente");
  const [q, setQ] = useState("");
  const [accion, setAccion] = useState<{ pago: PagoAdmin; aprobar: boolean } | null>(null);
  const [notas, setNotas] = useState("");
  const [procesando, setProcesando] = useState(false);
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
        id, numero, monto, metodo, referencia, comprobante_url, banco, estado, notas, created_at, fecha_verificacion, odoo_id, es_igtf, igtf_origen:igtf_origen_id(numero),
        orden:ordenes(numero, total),
        cliente:clientes(nombre_negocio)
      `)
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

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });

  const verComprobante = async (path: string) => {
    const { data, error } = await supabase.storage.from("documentos").createSignedUrl(path, 120);
    if (error || !data?.signedUrl) {
      toast({ title: "No se pudo abrir el comprobante", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const texto = q.trim().toLowerCase();
  const visibles = (filtro === "pendiente" ? pagos.filter((p) => p.estado === "pendiente") : pagos).filter((p) => !texto ||
    [p.numero, p.cliente?.nombre_negocio, p.referencia, p.orden?.numero, p.metodo].some((v) => (v || "").toLowerCase().includes(texto)));
  const { ordenadas, orden, alternar } = useOrdenTabla(visibles, {
    numero: (p) => p.numero, cliente: (p) => p.cliente?.nombre_negocio, orden: (p) => p.orden?.numero, monto: (p) => Number(p.monto || 0),
    metodo: (p) => p.metodo, referencia: (p) => p.referencia, fecha: (p) => p.created_at, estado: (p) => p.estado,
  });
  const pagination = usePagination(ordenadas, 50);
  const exportar = () => exportarCSV("cobros", ordenadas, [
    { titulo: "Pago", valor: (p) => p.numero }, { titulo: "Origen", valor: (p) => (p.odoo_id ? "Odoo" : "GUDS") },
    { titulo: "Cliente", valor: (p) => p.cliente?.nombre_negocio }, { titulo: "Orden", valor: (p) => p.orden?.numero },
    { titulo: "Monto USD", valor: (p) => Number(p.monto || 0) }, { titulo: "Método", valor: (p) => p.metodo }, { titulo: "Referencia", valor: (p) => p.referencia },
    { titulo: "Fecha", valor: (p) => p.created_at?.slice(0, 10) }, { titulo: "Estado", valor: (p) => estadoConfig[p.estado]?.label || p.estado },
    { titulo: "IGTF", valor: (p) => (p.es_igtf ? "Sí" : "") },
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
          { label: "Pagos por verificar", valor: pendientes.length, tono: pendientes.length > 0 ? "alerta" : "normal" },
          { label: "Monto pendiente", valor: formatPrice(montoPendiente), tono: "alerta" },
          { label: "Verificado", valor: formatPrice(montoVerificado), detalle: `${verificados.length} pagos`, tono: "positivo" },
        ]}
      />

      <BarraLista
        busqueda={q}
        onBusqueda={setQ}
        placeholder="Buscar número, cliente, referencia u orden..."
        filtros={
          <>
            <Button variant={filtro === "pendiente" ? "default" : "outline"} size="sm" onClick={() => setFiltro("pendiente")}>
              Por verificar ({pendientes.length})
            </Button>
            <Button variant={filtro === "todos" ? "default" : "outline"} size="sm" onClick={() => setFiltro("todos")}>
              Todos ({pagos.length})
            </Button>
          </>
        }
        contador={`${visibles.length} registros`}
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
            {texto ? `Sin resultados para "${q.trim()}"` : filtro === "pendiente" ? "No hay pagos pendientes de verificación" : "No hay pagos registrados"}
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
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(pago.created_at)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Badge variant={estadoConfig[pago.estado]?.variant || "secondary"}>
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
                          onClick={() => { setAccion({ pago, aprobar: true }); setNotas(""); }}
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
                      <span className="text-xs text-muted-foreground">
                        {pago.fecha_verificacion ? formatDate(pago.fecha_verificacion) : ""}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!loading && <DataTablePagination pagination={pagination} />}
      </div>

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
