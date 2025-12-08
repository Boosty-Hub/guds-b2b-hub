import { useState, useEffect } from "react";
import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";

const ConfigNotificaciones = () => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({
    email_nuevas_ordenes: true,
    email_pagos: true,
    email_inventario: true,
    email_vencidos: true,
    push_activo: true,
    push_sonido: false,
    resumen_diario: true,
    resumen_semanal: false,
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    const { data } = await supabase
      .from('configuracion')
      .select('*')
      .like('clave', 'notif_%');
    
    if (data) {
      const newConfig = { ...config };
      data.forEach(item => {
        const key = item.clave.replace('notif_', '');
        if (key in newConfig) {
          (newConfig as Record<string, boolean>)[key] = item.valor === 'true';
        }
      });
      setConfig(newConfig);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    
    // Upsert each config value
    for (const [key, value] of Object.entries(config)) {
      await supabase
        .from('configuracion')
        .upsert({
          clave: `notif_${key}`,
          valor: String(value),
          tipo: 'boolean',
          descripcion: `Notificación: ${key}`,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'clave' });
    }

    toast({
      title: "Configuración guardada",
      description: "Las preferencias de notificación han sido actualizadas",
    });
    setSaving(false);
  };

  const updateConfig = (key: keyof typeof config, value: boolean) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  return (
    <ConfiguracionLayout 
      title="Notificaciones" 
      description="Configura cómo y cuándo recibir alertas"
    >
      <div className="space-y-6">
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Notificaciones por Email</CardTitle>
            <CardDescription>Alertas enviadas a tu correo electrónico</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Nuevas órdenes</p>
                <p className="text-sm text-muted-foreground">Notificar cuando llegue una nueva orden</p>
              </div>
              <Switch checked={config.email_nuevas_ordenes} onCheckedChange={(v) => updateConfig('email_nuevas_ordenes', v)} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Pagos recibidos</p>
                <p className="text-sm text-muted-foreground">Notificar cuando se registre un pago</p>
              </div>
              <Switch checked={config.email_pagos} onCheckedChange={(v) => updateConfig('email_pagos', v)} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Alertas de inventario</p>
                <p className="text-sm text-muted-foreground">Notificar sobre productos con bajo stock</p>
              </div>
              <Switch checked={config.email_inventario} onCheckedChange={(v) => updateConfig('email_inventario', v)} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Cuentas vencidas</p>
                <p className="text-sm text-muted-foreground">Notificar sobre pagos pendientes vencidos</p>
              </div>
              <Switch checked={config.email_vencidos} onCheckedChange={(v) => updateConfig('email_vencidos', v)} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle>Notificaciones Push</CardTitle>
            <CardDescription>Alertas en tiempo real en el navegador</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Activar notificaciones push</p>
                <p className="text-sm text-muted-foreground">Recibir alertas en tiempo real</p>
              </div>
              <Switch checked={config.push_activo} onCheckedChange={(v) => updateConfig('push_activo', v)} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Sonido de notificación</p>
                <p className="text-sm text-muted-foreground">Reproducir sonido al recibir alertas</p>
              </div>
              <Switch checked={config.push_sonido} onCheckedChange={(v) => updateConfig('push_sonido', v)} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle>Resumen Diario</CardTitle>
            <CardDescription>Recibe un resumen de actividad por email</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Enviar resumen diario</p>
                <p className="text-sm text-muted-foreground">Recibir un resumen de ventas y actividad cada día</p>
              </div>
              <Switch checked={config.resumen_diario} onCheckedChange={(v) => updateConfig('resumen_diario', v)} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Enviar resumen semanal</p>
                <p className="text-sm text-muted-foreground">Recibir un resumen cada lunes</p>
              </div>
              <Switch checked={config.resumen_semanal} onCheckedChange={(v) => updateConfig('resumen_semanal', v)} />
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Guardar Preferencias
        </Button>
      </div>
    </ConfiguracionLayout>
  );
};

export default ConfigNotificaciones;
