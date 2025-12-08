import { useState, useEffect } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { 
  ChevronLeft,
  Ticket,
  Loader2,
  Copy,
  Check,
  Clock,
  Percent,
  Gift
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

interface CuponDB {
  id: string;
  codigo: string;
  tipo: string;
  valor: number;
  descripcion: string;
  fecha_inicio: string;
  fecha_fin: string;
  uso_maximo: number;
  usos_actuales: number;
  activo: boolean;
}

const PortalCupones = () => {
  const { formatPrice } = useCurrency();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [cupones, setCupones] = useState<CuponDB[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [codigoInput, setCodigoInput] = useState("");

  useEffect(() => {
    fetchCupones();
  }, []);

  const fetchCupones = async () => {
    setLoading(true);
    
    // Fetch cupones activos (públicos o del cliente)
    const { data } = await supabase
      .from('cupones')
      .select('*')
      .eq('activo', true)
      .or(`cliente_especifico_id.is.null,cliente_especifico_id.eq.${user?.cliente_id}`)
      .gte('fecha_fin', new Date().toISOString())
      .order('fecha_fin', { ascending: true });
    
    if (data) setCupones(data);
    setLoading(false);
  };

  const copyCode = (id: string, codigo: string) => {
    navigator.clipboard.writeText(codigo);
    setCopiedId(id);
    toast({ title: "Copiado", description: "Código copiado al portapapeles" });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es-ES', { 
      day: 'numeric', 
      month: 'short'
    });
  };

  const getDaysRemaining = (dateStr: string) => {
    const diff = new Date(dateStr).getTime() - new Date().getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  return (
    <PortalMobileLayout showHeader={false} showNav={false}>
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold">Mis Cupones</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Add Coupon */}
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Ticket className="h-5 w-5 text-primary" />
            ¿Tienes un código?
          </h3>
          <div className="flex gap-2">
            <Input
              placeholder="Ingresa tu código"
              value={codigoInput}
              onChange={(e) => setCodigoInput(e.target.value.toUpperCase())}
              className="flex-1"
            />
            <Button disabled={!codigoInput}>Aplicar</Button>
          </div>
        </div>

        {/* Coupons List */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : cupones.length === 0 ? (
          <div className="text-center py-12">
            <div className="h-20 w-20 rounded-full bg-muted mx-auto flex items-center justify-center mb-4">
              <Gift className="h-10 w-10 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Sin cupones</h3>
            <p className="text-muted-foreground">
              No tienes cupones disponibles en este momento
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <h3 className="font-semibold">Cupones disponibles ({cupones.length})</h3>
            
            {cupones.map((cupon) => {
              const daysRemaining = getDaysRemaining(cupon.fecha_fin);
              const isExpiringSoon = daysRemaining <= 7;
              
              return (
                <div
                  key={cupon.id}
                  className="bg-card rounded-xl border border-border overflow-hidden"
                >
                  {/* Coupon Header */}
                  <div className="bg-gradient-to-r from-primary to-primary/80 p-4 text-white">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center">
                          {cupon.tipo === 'porcentaje' ? (
                            <Percent className="h-6 w-6" />
                          ) : (
                            <Ticket className="h-6 w-6" />
                          )}
                        </div>
                        <div>
                          <p className="text-2xl font-bold">
                            {cupon.tipo === 'porcentaje' 
                              ? `${cupon.valor}%` 
                              : formatPrice(cupon.valor)}
                          </p>
                          <p className="text-sm opacity-90">de descuento</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Coupon Body */}
                  <div className="p-4">
                    <p className="font-medium mb-2">{cupon.descripcion || 'Cupón de descuento'}</p>
                    
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>Vence {formatDate(cupon.fecha_fin)}</span>
                      </div>
                      {isExpiringSoon && (
                        <Badge variant="destructive" className="text-xs">
                          ¡{daysRemaining} días!
                        </Badge>
                      )}
                    </div>

                    {/* Code */}
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-lg px-4 py-2 font-mono font-bold text-center">
                        {cupon.codigo}
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => copyCode(cupon.id, cupon.codigo)}
                      >
                        {copiedId === cupon.id ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PortalMobileLayout>
  );
};

export default PortalCupones;
