import { useState, useEffect } from "react";
import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  DollarSign, 
  RefreshCw, 
  TrendingUp, 
  TrendingDown,
  Clock,
  History,
  AlertCircle,
  CheckCircle,
  Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useCurrency } from "@/contexts/CurrencyContext";

const ConfigMoneda = () => {
  const { setExchangeRate } = useCurrency();
  const [tasaActual, setTasaActual] = useState("36.50");
  const [nuevaTasa, setNuevaTasa] = useState("");
  const [monedaPrincipal, setMonedaPrincipal] = useState("USD");
  const [monedaSecundaria, setMonedaSecundaria] = useState("BS");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('configuracion')
      .select('*')
      .in('clave', ['tasa_cambio', 'moneda_principal', 'moneda_secundaria']);
    
    if (data) {
      data.forEach(config => {
        if (config.clave === 'tasa_cambio') {
          setTasaActual(config.valor);
          setLastUpdate(config.updated_at);
        }
        if (config.clave === 'moneda_principal') setMonedaPrincipal(config.valor);
        if (config.clave === 'moneda_secundaria') setMonedaSecundaria(config.valor);
      });
    }
    setLoading(false);
  };

  const handleActualizarTasa = async () => {
    if (!nuevaTasa || parseFloat(nuevaTasa) <= 0) {
      toast({
        title: "Error",
        description: "Ingresa una tasa válida",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from('configuracion')
      .update({ valor: nuevaTasa, updated_at: new Date().toISOString() })
      .eq('clave', 'tasa_cambio');

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      const tasaAnterior = parseFloat(tasaActual);
      const tasaNuevaNum = parseFloat(nuevaTasa);
      const diferencia = ((tasaNuevaNum - tasaAnterior) / tasaAnterior * 100).toFixed(2);

      setTasaActual(nuevaTasa);
      setNuevaTasa("");
      setLastUpdate(new Date().toISOString());
      // Reflejar la nueva tasa en toda la app sin recargar
      setExchangeRate(tasaNuevaNum);

      toast({
        title: "Tasa Actualizada",
        description: `Nueva tasa: 1 USD = ${nuevaTasa} Bs. (${parseFloat(diferencia) >= 0 ? "+" : ""}${diferencia}%)`,
      });
    }
    setSaving(false);
  };

  const handleSaveMonedaPrincipal = async (moneda: string) => {
    const anterior = monedaPrincipal;
    setMonedaPrincipal(moneda);
    const { error } = await supabase
      .from('configuracion')
      .update({ valor: moneda, updated_at: new Date().toISOString() })
      .eq('clave', 'moneda_principal');
    if (error) {
      setMonedaPrincipal(anterior); // revertir el cambio optimista
      toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Guardado", description: `Moneda principal: ${moneda}` });
  };

  const formatLastUpdate = () => {
    if (!lastUpdate) return "No disponible";
    return new Date(lastUpdate).toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const tasaNum = parseFloat(tasaActual);
  const ejemploUSD = 100;
  const ejemploBS = ejemploUSD * tasaNum;

  return (
    <ConfiguracionLayout 
      title="Configuración de Moneda" 
      description="Gestiona la tasa de cambio USD/Bs y preferencias de moneda"
    >
      {/* Current Rate Card */}
      <Card className="border-border mb-6 bg-gradient-to-r from-green-500/10 to-emerald-500/5">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Tasa de Cambio Actual</p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold text-foreground">1 USD</span>
                <span className="text-2xl text-muted-foreground">=</span>
                <span className="text-4xl font-bold text-green-500">{tasaActual} Bs.</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Última actualización: {formatLastUpdate()}
              </p>
            </div>
            <div className="h-20 w-20 rounded-full bg-green-500/20 flex items-center justify-center">
              <DollarSign className="h-10 w-10 text-green-500" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        {/* Update Rate */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Actualizar Tasa
            </CardTitle>
            <CardDescription>Ingresa la nueva tasa de cambio manualmente</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nueva Tasa (1 USD = X Bs.)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Ej: 37.50"
                  value={nuevaTasa}
                  onChange={(e) => setNuevaTasa(e.target.value)}
                />
                <Button onClick={handleActualizarTasa} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Actualizar"}
                </Button>
              </div>
            </div>

            {nuevaTasa && parseFloat(nuevaTasa) > 0 && (
              <div className="rounded-lg bg-muted p-4">
                <p className="text-sm text-muted-foreground mb-2">Vista previa del cambio:</p>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{tasaActual} Bs.</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-medium text-green-500">{nuevaTasa} Bs.</span>
                  {parseFloat(nuevaTasa) > parseFloat(tasaActual) ? (
                    <Badge className="bg-green-500/10 text-green-500 gap-1">
                      <TrendingUp className="h-3 w-3" />
                      +{((parseFloat(nuevaTasa) - parseFloat(tasaActual)) / parseFloat(tasaActual) * 100).toFixed(2)}%
                    </Badge>
                  ) : (
                    <Badge className="bg-red-500/10 text-red-500 gap-1">
                      <TrendingDown className="h-3 w-3" />
                      {((parseFloat(nuevaTasa) - parseFloat(tasaActual)) / parseFloat(tasaActual) * 100).toFixed(2)}%
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Conversion Example */}
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Ejemplo de Conversión</CardTitle>
            <CardDescription>Así se verán los precios con la tasa actual</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-blue-500/10 p-4 text-center">
                  <DollarSign className="h-8 w-8 mx-auto text-blue-500 mb-2" />
                  <p className="text-2xl font-bold">${ejemploUSD.toFixed(2)}</p>
                  <p className="text-sm text-muted-foreground">Dólares (USD)</p>
                </div>
                <div className="rounded-lg bg-green-500/10 p-4 text-center">
                  <span className="text-2xl font-bold text-green-500 block mb-2">Bs.</span>
                  <p className="text-2xl font-bold">{ejemploBS.toLocaleString("es-VE", { minimumFractionDigits: 2 })}</p>
                  <p className="text-sm text-muted-foreground">Bolívares (Bs.)</p>
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <p className="text-sm text-muted-foreground mb-2">Más ejemplos:</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>$50.00 USD</span>
                    <span className="font-medium">{(50 * tasaNum).toLocaleString("es-VE", { minimumFractionDigits: 2 })} Bs.</span>
                  </div>
                  <div className="flex justify-between">
                    <span>$250.00 USD</span>
                    <span className="font-medium">{(250 * tasaNum).toLocaleString("es-VE", { minimumFractionDigits: 2 })} Bs.</span>
                  </div>
                  <div className="flex justify-between">
                    <span>$1,000.00 USD</span>
                    <span className="font-medium">{(1000 * tasaNum).toLocaleString("es-VE", { minimumFractionDigits: 2 })} Bs.</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Settings */}
      <Card className="border-border mb-6">
        <CardHeader>
          <CardTitle>Configuración de Visualización</CardTitle>
          <CardDescription>Opciones de cómo se muestran las monedas en el sistema</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Moneda Principal del Sistema</p>
              <p className="text-sm text-muted-foreground">
                Los precios se almacenan en esta moneda
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant={monedaPrincipal === "USD" ? "default" : "outline"}
                size="sm"
                onClick={() => handleSaveMonedaPrincipal("USD")}
              >
                USD ($)
              </Button>
              <Button 
                variant={monedaPrincipal === "BS" ? "default" : "outline"}
                size="sm"
                onClick={() => handleSaveMonedaPrincipal("BS")}
              >
                Bs.
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">Permitir cambio de moneda en Portales</p>
              <p className="text-sm text-muted-foreground">
                Clientes y vendedores pueden cambiar entre USD y Bs.
              </p>
            </div>
            <Switch defaultChecked />
          </div>
        </CardContent>
      </Card>

      {/* Info */}
      <Card className="border-border">
        <CardContent className="p-6">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-500" />
            <div>
              <p className="font-medium">Configuración guardada automáticamente</p>
              <p className="text-sm text-muted-foreground">Los cambios se guardan en la base de datos al realizarlos</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </ConfiguracionLayout>
  );
};

export default ConfigMoneda;
