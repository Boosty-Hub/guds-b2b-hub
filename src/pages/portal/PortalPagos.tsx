import { useState, useEffect, useRef } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CreditCard,
  Upload,
  Clock,
  CheckCircle,
  AlertCircle,
  ChevronRight,
  Plus,
  Loader2,
  Receipt,
  Banknote,
  Paperclip
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/image";
import { useToast } from "@/hooks/use-toast";

const MAX_COMPROBANTE_SIZE = 5 * 1024 * 1024;
const ALLOWED_COMPROBANTE_TYPES = ["application/pdf", "image/jpeg", "image/png"];

interface PagoDB {
  id: string;
  monto: number;
  metodo: string;
  referencia: string;
  estado: string;
  created_at: string;
  orden_id?: string;
  orden?: {
    numero: string;
  };
}

interface OrdenPendiente {
  id: string;
  numero: string;
  total: number;
  estado: string;
  created_at: string;
}

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  pendiente: { label: "Pendiente", color: "bg-yellow-500", icon: Clock },
  verificando: { label: "Verificando", color: "bg-blue-500", icon: Clock },
  verificado: { label: "Verificado", color: "bg-green-500", icon: CheckCircle },
  aprobado: { label: "Aprobado", color: "bg-green-500", icon: CheckCircle },
  rechazado: { label: "Rechazado", color: "bg-red-500", icon: AlertCircle },
};

const metodoLabel: Record<string, string> = {
  transferencia: "Transferencia", efectivo: "Efectivo", pago_movil: "Pago Móvil", credito: "Crédito", tarjeta: "Tarjeta",
};

const PortalPagos = () => {
  const { formatPrice, exchangeRate } = useCurrency();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [activeTab, setActiveTab] = useState<"pendientes" | "historial">("pendientes");
  const [pagos, setPagos] = useState<PagoDB[]>([]);
  const [ordenesPendientes, setOrdenesPendientes] = useState<OrdenPendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    orden_id: "",
    monto: "",
    banco_id: "",
    metodo: "",
    tasa: "",
    referencia: "",
  });
  const [bancos, setBancos] = useState<{ id: string; nombre: string; metodo_pago: string; metodos: string[] | null; moneda: string; numero_cuenta: string | null }[]>([]);
  const [comprobanteFile, setComprobanteFile] = useState<File | null>(null);
  const [uploadingComprobante, setUploadingComprobante] = useState(false);
  const comprobanteInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user?.cliente_id) {
      fetchData();
    }
  }, [user]);

  const fetchData = async () => {
    setLoading(true);

    // Fetch pagos
    const { data: pagosData } = await supabase
      .from('pagos')
      .select(`
        *,
        orden:ordenes(numero)
      `)
      .eq('cliente_id', user?.cliente_id)
      .order('created_at', { ascending: false });

    if (pagosData) setPagos(pagosData);

    // Fetch órdenes pendientes de pago
    const { data: ordenesData } = await supabase
      .from('ordenes')
      .select('id, numero, total, estado, created_at')
      .eq('cliente_id', user?.cliente_id)
      .in('estado', ['pendiente', 'confirmado', 'procesando', 'enviado'])
      .order('created_at', { ascending: false });

    if (ordenesData) setOrdenesPendientes(ordenesData);

    // Bancos activos (a dónde puede pagar el cliente)
    const { data: bancosData } = await supabase
      .from('bancos')
      .select('id, nombre, metodo_pago, metodos, moneda, numero_cuenta')
      .eq('activo', true)
      .order('nombre');
    if (bancosData) setBancos(bancosData);

    setLoading(false);
  };

  const bancoSel = bancos.find((b) => b.id === formData.banco_id);
  const esBS = bancoSel?.moneda === "BS";
  const metodosBanco = bancoSel?.metodos?.length ? bancoSel.metodos : bancoSel ? [bancoSel.metodo_pago] : [];

  const handleComprobanteSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_COMPROBANTE_TYPES.includes(file.type)) {
      toast({ title: "Formato no permitido", description: "Solo se aceptan PDF, JPG o PNG", variant: "destructive" });
      return;
    }
    if (file.size > MAX_COMPROBANTE_SIZE) {
      toast({ title: "Archivo muy grande", description: "El máximo es 5 MB", variant: "destructive" });
      return;
    }
    setComprobanteFile(file);
  };

  const uploadComprobante = async (file: File): Promise<string> => {
    const isImage = file.type.startsWith("image/");
    const body = isImage ? await compressImage(file, 1600, 0.85) : file;
    const ext = isImage ? "jpg" : "pdf";
    const path = `comprobantes/${user?.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("documentos").upload(path, body, {
      contentType: isImage ? "image/jpeg" : "application/pdf",
    });
    if (error) throw error;
    return path;
  };

  const handleSubmitPayment = async () => {
    if (!formData.orden_id || !formData.monto || !formData.banco_id || !formData.referencia) {
      toast({ title: "Error", description: "Completa la orden, el banco, el monto y la referencia", variant: "destructive" });
      return;
    }
    if (esBS && (!formData.tasa || Number(formData.tasa) <= 0)) {
      toast({ title: "Falta la tasa", description: "Indica la tasa (Bs. por USD) para un pago en bolívares.", variant: "destructive" });
      return;
    }

    setSaving(true);

    let comprobanteUrl: string | null = null;
    if (comprobanteFile) {
      setUploadingComprobante(true);
      try {
        comprobanteUrl = await uploadComprobante(comprobanteFile);
      } catch (err) {
        toast({ title: "No se pudo subir el comprobante", description: (err as Error).message, variant: "destructive" });
        setSaving(false);
        setUploadingComprobante(false);
        return;
      }
      setUploadingComprobante(false);
    }

    const { error } = await supabase.rpc("registrar_pago", {
      p_cliente_id: user?.cliente_id,
      p_orden_id: formData.orden_id,
      p_banco_id: formData.banco_id,
      p_metodo: formData.metodo || metodosBanco[0] || bancoSel?.metodo_pago || "transferencia",
      p_monto_moneda: parseFloat(formData.monto),
      p_moneda: bancoSel?.moneda || "USD",
      p_tasa_cambio: esBS ? Number(formData.tasa) : null,
      p_referencia: formData.referencia,
      p_comprobante_url: comprobanteUrl,
    });

    setSaving(false);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Pago reportado", description: "Tu pago está pendiente de verificación" });
      setFormData({ orden_id: "", monto: "", banco_id: "", metodo: "", tasa: "", referencia: "" });
      setComprobanteFile(null);
      setIsPaymentOpen(false);
      fetchData();
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es-ES', { 
      day: 'numeric', 
      month: 'short', 
      year: 'numeric' 
    });
  };

  const pagosPendientes = pagos.filter(p => p.estado === 'pendiente' || p.estado === 'verificando');
  const pagosVerificados = pagos.filter(p => p.estado === 'verificado' || p.estado === 'aprobado');
  const displayPagos = activeTab === "pendientes" ? pagosPendientes : pagosVerificados;

  const totalPendiente = ordenesPendientes.reduce((sum, o) => sum + o.total, 0);
  const totalPagado = pagosVerificados.reduce((sum, p) => sum + p.monto, 0);

  return (
    <PortalMobileLayout title="Pagos">
      {/* Stats Cards */}
      <div className="px-4 pt-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-lg font-bold">{formatPrice(totalPendiente)}</p>
                <p className="text-xs text-muted-foreground">Por pagar</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-lg font-bold">{formatPrice(totalPagado)}</p>
                <p className="text-xs text-muted-foreground">Pagado</p>
              </div>
            </div>
          </div>
        </div>

        {/* Register Payment Button */}
        <Button 
          className="w-full gap-2" 
          size="lg"
          onClick={() => setIsPaymentOpen(true)}
        >
          <Plus className="h-5 w-5" />
          Registrar Pago
        </Button>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-4">
        <div className="flex bg-muted rounded-xl p-1">
          <button
            onClick={() => setActiveTab("pendientes")}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "pendientes"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            Pendientes ({pagosPendientes.length})
          </button>
          <button
            onClick={() => setActiveTab("historial")}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
              activeTab === "historial"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            Verificados ({pagosVerificados.length})
          </button>
        </div>
      </div>

      {/* Payments List */}
      <div className="px-4 py-4 space-y-3">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : displayPagos.length === 0 ? (
          <div className="text-center py-12">
            <div className="h-16 w-16 rounded-full bg-muted mx-auto flex items-center justify-center mb-4">
              <Receipt className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">
              {activeTab === "pendientes" 
                ? "No tienes pagos pendientes" 
                : "No hay pagos verificados"}
            </p>
          </div>
        ) : (
          displayPagos.map((pago) => {
            const config = statusConfig[pago.estado] || statusConfig.pendiente;
            const StatusIcon = config.icon;

            return (
              <div
                key={pago.id}
                className="bg-card rounded-xl border border-border p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`h-10 w-10 rounded-full ${config.color}/10 flex items-center justify-center`}>
                      <StatusIcon className={`h-5 w-5 ${config.color.replace('bg-', 'text-')}`} />
                    </div>
                    <div>
                      <p className="font-semibold">{formatPrice(pago.monto)}</p>
                      <p className="text-xs text-muted-foreground">
                        {pago.orden?.numero || 'Sin orden'}
                      </p>
                    </div>
                  </div>
                  <Badge className={`${config.color} text-white`}>
                    {config.label}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-muted-foreground">Método</p>
                    <p className="font-medium">{metodoLabel[pago.metodo] || pago.metodo}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Referencia</p>
                    <p className="font-medium font-mono">{pago.referencia}</p>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-border flex justify-between items-center">
                  <p className="text-xs text-muted-foreground">{formatDate(pago.created_at)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pending Orders Section */}
      {ordenesPendientes.length > 0 && (
        <div className="px-4 pb-6">
          <h3 className="font-semibold mb-3">Órdenes pendientes de pago</h3>
          <div className="space-y-2">
            {ordenesPendientes.map((orden) => (
              <div
                key={orden.id}
                className="bg-card rounded-xl border border-border p-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Banknote className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{orden.numero}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(orden.created_at)}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-primary">{formatPrice(orden.total)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payment Registration Sheet */}
      <Sheet open={isPaymentOpen} onOpenChange={setIsPaymentOpen}>
        <SheetContent side="bottom" className="h-[85vh] rounded-t-3xl">
          <SheetHeader>
            <SheetTitle>Registrar Pago</SheetTitle>
          </SheetHeader>
          
          <div className="mt-6 space-y-4">
            {/* Select Order */}
            <div className="space-y-2">
              <Label>Orden a pagar</Label>
              <Select 
                value={formData.orden_id} 
                onValueChange={(v) => {
                  const orden = ordenesPendientes.find(o => o.id === v);
                  setFormData({ 
                    ...formData, 
                    orden_id: v,
                    monto: orden ? orden.total.toString() : ""
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar orden" />
                </SelectTrigger>
                <SelectContent>
                  {ordenesPendientes.map((orden) => (
                    <SelectItem key={orden.id} value={orden.id}>
                      {orden.numero} - {formatPrice(orden.total)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Banco al que se paga */}
            <div className="space-y-2">
              <Label>Banco / cuenta donde pagaste</Label>
              <div className="grid grid-cols-1 gap-2">
                {bancos.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      const ms = b.metodos?.length ? b.metodos : [b.metodo_pago];
                      setFormData({ ...formData, banco_id: b.id, metodo: ms[0] || "transferencia", tasa: b.moneda === "BS" && exchangeRate > 0 ? String(exchangeRate) : "" });
                    }}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      formData.banco_id === b.id ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{b.nombre}</p>
                      <span className="text-xs font-semibold">{b.moneda === "USD" ? "USD $" : "Bs."}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {b.numero_cuenta || (b.metodos?.length ? b.metodos.map((m) => metodoLabel[m] || m).join(", ") : (metodoLabel[b.metodo_pago] || b.metodo_pago))}
                    </p>
                  </button>
                ))}
                {bancos.length === 0 && <p className="text-sm text-muted-foreground">No hay cuentas de pago disponibles.</p>}
              </div>
            </div>

            {/* Método (del banco elegido) */}
            {formData.banco_id && metodosBanco.length > 0 && (
              <div className="space-y-2">
                <Label>Método</Label>
                <Select value={formData.metodo} onValueChange={(v) => setFormData({ ...formData, metodo: v })}>
                  <SelectTrigger><SelectValue placeholder="Método" /></SelectTrigger>
                  <SelectContent>
                    {metodosBanco.map((m) => <SelectItem key={m} value={m}>{metodoLabel[m] || m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Amount */}
            <div className="space-y-2">
              <Label>{esBS ? "Monto pagado (Bs.)" : "Monto pagado (USD $)"}</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={formData.monto}
                onChange={(e) => setFormData({ ...formData, monto: e.target.value })}
              />
            </div>

            {/* Tasa (si BS) */}
            {esBS && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Tasa de cambio (Bs. por 1 USD)</Label>
                  <span className="text-[11px] text-muted-foreground">Tasa BCV precargada</span>
                </div>
                <Input
                  type="number"
                  placeholder="Ej: 400"
                  value={formData.tasa}
                  onChange={(e) => setFormData({ ...formData, tasa: e.target.value })}
                />
                {formData.monto && formData.tasa && Number(formData.tasa) > 0 && (
                  <div className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2">
                    <span className="text-xs text-muted-foreground">Equivale a</span>
                    <span className="text-sm font-semibold">{formatPrice(Number(formData.monto) / Number(formData.tasa))}</span>
                  </div>
                )}
              </div>
            )}

            {/* Reference */}
            <div className="space-y-2">
              <Label>Número de referencia</Label>
              <Input
                placeholder="Ej: 123456789"
                value={formData.referencia}
                onChange={(e) => setFormData({ ...formData, referencia: e.target.value })}
              />
            </div>

            {/* Upload Section */}
            <div className="space-y-2">
              <Label>Comprobante (opcional)</Label>
              <input
                ref={comprobanteInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                className="hidden"
                onChange={handleComprobanteSelect}
              />
              <button
                type="button"
                onClick={() => comprobanteInputRef.current?.click()}
                disabled={uploadingComprobante}
                className="w-full border-2 border-dashed border-border rounded-xl p-6 text-center disabled:opacity-50"
              >
                {comprobanteFile ? (
                  <span className="flex items-center justify-center gap-2 text-sm">
                    <Paperclip className="h-4 w-4 text-primary" />
                    {comprobanteFile.name}
                  </span>
                ) : (
                  <>
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {uploadingComprobante ? "Subiendo..." : "Toca para subir comprobante"}
                    </p>
                  </>
                )}
              </button>
            </div>

            {/* Submit Button */}
            <Button 
              className="w-full h-12" 
              size="lg"
              onClick={handleSubmitPayment}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <CreditCard className="h-5 w-5 mr-2" />
                  Enviar Pago
                </>
              )}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </PortalMobileLayout>
  );
};

export default PortalPagos;
