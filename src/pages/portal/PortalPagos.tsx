import { useState, useEffect } from "react";
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
  Banknote
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
import { useToast } from "@/hooks/use-toast";

interface PagoDB {
  id: string;
  monto: number;
  metodo_pago: string;
  referencia: string;
  estado: string;
  created_at: string;
  orden_id?: string;
  orden?: {
    numero_orden: string;
  };
}

interface OrdenPendiente {
  id: string;
  numero_orden: string;
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

const metodosPago = [
  { id: "transferencia", name: "Transferencia Bancaria", icon: "🏦" },
  { id: "deposito", name: "Depósito", icon: "💵" },
  { id: "pago_movil", name: "Pago Móvil", icon: "📱" },
  { id: "efectivo", name: "Efectivo", icon: "💰" },
];

const PortalPagos = () => {
  const { formatPrice } = useCurrency();
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
    metodo_pago: "",
    referencia: "",
  });

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
        orden:ordenes(numero_orden)
      `)
      .eq('cliente_id', user?.cliente_id)
      .order('created_at', { ascending: false });
    
    if (pagosData) setPagos(pagosData);

    // Fetch órdenes pendientes de pago
    const { data: ordenesData } = await supabase
      .from('ordenes')
      .select('id, numero_orden, total, estado, created_at')
      .eq('cliente_id', user?.cliente_id)
      .in('estado', ['pendiente', 'confirmado', 'procesando', 'enviado'])
      .order('created_at', { ascending: false });
    
    if (ordenesData) setOrdenesPendientes(ordenesData);

    setLoading(false);
  };

  const handleSubmitPayment = async () => {
    if (!formData.orden_id || !formData.monto || !formData.metodo_pago || !formData.referencia) {
      toast({ title: "Error", description: "Completa todos los campos", variant: "destructive" });
      return;
    }

    setSaving(true);

    const { error } = await supabase.from('pagos').insert({
      cliente_id: user?.cliente_id,
      orden_id: formData.orden_id,
      monto: parseFloat(formData.monto),
      metodo_pago: formData.metodo_pago,
      referencia: formData.referencia,
      estado: 'pendiente',
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Pago registrado", description: "Tu pago está pendiente de verificación" });
      setFormData({ orden_id: "", monto: "", metodo_pago: "", referencia: "" });
      setIsPaymentOpen(false);
      fetchData();
    }

    setSaving(false);
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
                        {pago.orden?.numero_orden || 'Sin orden'}
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
                    <p className="font-medium capitalize">{pago.metodo_pago.replace('_', ' ')}</p>
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
                    <p className="font-medium">{orden.numero_orden}</p>
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
                      {orden.numero_orden} - {formatPrice(orden.total)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <Label>Método de pago</Label>
              <div className="grid grid-cols-2 gap-2">
                {metodosPago.map((metodo) => (
                  <button
                    key={metodo.id}
                    onClick={() => setFormData({ ...formData, metodo_pago: metodo.id })}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      formData.metodo_pago === metodo.id
                        ? "border-primary bg-primary/5"
                        : "border-border"
                    }`}
                  >
                    <span className="text-xl">{metodo.icon}</span>
                    <p className="text-sm font-medium mt-1">{metodo.name}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <Label>Monto</Label>
              <Input
                type="number"
                placeholder="0.00"
                value={formData.monto}
                onChange={(e) => setFormData({ ...formData, monto: e.target.value })}
              />
            </div>

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
              <div className="border-2 border-dashed border-border rounded-xl p-6 text-center">
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  Toca para subir comprobante
                </p>
              </div>
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
