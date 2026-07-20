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
import { CheckCircle, XCircle, Clock, Loader2, Wallet } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/hooks/use-toast";

interface PagoAdmin {
  id: string;
  numero: string;
  monto: number;
  metodo: string;
  referencia: string | null;
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
        id, numero, monto, metodo, referencia, banco, estado, notas, created_at, fecha_verificacion,
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

  const visibles = filtro === "pendiente" ? pagos.filter((p) => p.estado === "pendiente") : pagos;
  const pendientes = pagos.filter((p) => p.estado === "pendiente");
  const montoPendiente = pendientes.reduce((s, p) => s + Number(p.monto || 0), 0);
  const verificados = pagos.filter((p) => p.estado === "verificado");
  const montoVerificado = verificados.reduce((s, p) => s + Number(p.monto || 0), 0);

  return (
    <MainLayout title="Verificación de Pagos">
      <div className="space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-yellow-500/10 flex items-center justify-center">
                <Clock className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{pendientes.length}</p>
                <p className="text-sm text-muted-foreground">Pagos por verificar</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatPrice(montoPendiente)}</p>
                <p className="text-sm text-muted-foreground">Monto pendiente</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{formatPrice(montoVerificado)}</p>
                <p className="text-sm text-muted-foreground">Verificado ({verificados.length})</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filtro */}
        <div className="flex gap-2">
          <Button variant={filtro === "pendiente" ? "default" : "outline"} size="sm" onClick={() => setFiltro("pendiente")}>
            Por verificar ({pendientes.length})
          </Button>
          <Button variant={filtro === "todos" ? "default" : "outline"} size="sm" onClick={() => setFiltro("todos")}>
            Todos ({pagos.length})
          </Button>
        </div>

        {/* Tabla */}
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : visibles.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              {filtro === "pendiente" ? "No hay pagos pendientes de verificación" : "No hay pagos registrados"}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pago</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Orden</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibles.map((pago) => (
                  <TableRow key={pago.id} className="hover:bg-muted/50">
                    <TableCell className="font-medium text-primary">{pago.numero}</TableCell>
                    <TableCell>{pago.cliente?.nombre_negocio || "N/A"}</TableCell>
                    <TableCell className="text-muted-foreground">{pago.orden?.numero || "—"}</TableCell>
                    <TableCell className="text-right font-semibold">{formatPrice(pago.monto)}</TableCell>
                    <TableCell className="capitalize">{pago.metodo?.replace("_", " ")}</TableCell>
                    <TableCell className="text-muted-foreground">{pago.referencia || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(pago.created_at)}</TableCell>
                    <TableCell>
                      <Badge variant={estadoConfig[pago.estado]?.variant || "secondary"}>
                        {estadoConfig[pago.estado]?.label || pago.estado}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {pago.estado === "pendiente" ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-500/10"
                            title="Verificar pago"
                            onClick={() => { setAccion({ pago, aprobar: true }); setNotas(""); }}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            title="Rechazar pago"
                            onClick={() => { setAccion({ pago, aprobar: false }); setNotas(""); }}
                          >
                            <XCircle className="h-4 w-4" />
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
        </div>
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
