import { useState } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { 
  ChevronLeft,
  Bell,
  Package,
  Truck,
  CreditCard,
  Percent,
  MessageSquare
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const notificationSettings = [
  {
    id: "pedidos",
    icon: Package,
    title: "Pedidos",
    description: "Actualizaciones sobre el estado de tus pedidos",
    enabled: true,
  },
  {
    id: "entregas",
    icon: Truck,
    title: "Entregas",
    description: "Notificaciones cuando tu pedido está en camino",
    enabled: true,
  },
  {
    id: "pagos",
    icon: CreditCard,
    title: "Pagos",
    description: "Confirmaciones de pagos y facturas",
    enabled: true,
  },
  {
    id: "ofertas",
    icon: Percent,
    title: "Ofertas y promociones",
    description: "Descuentos exclusivos y ofertas especiales",
    enabled: false,
  },
  {
    id: "mensajes",
    icon: MessageSquare,
    title: "Mensajes",
    description: "Comunicaciones de tu vendedor asignado",
    enabled: true,
  },
];

const PortalNotificaciones = () => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(notificationSettings);

  const toggleSetting = (id: string) => {
    setSettings(prev => 
      prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s)
    );
  };

  return (
    <PortalMobileLayout showHeader={false} showNav={false}>
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold">Notificaciones</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Push Notifications */}
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Bell className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Notificaciones Push</p>
                <p className="text-sm text-muted-foreground">Recibir alertas en tu dispositivo</p>
              </div>
            </div>
            <Switch defaultChecked />
          </div>
        </div>

        {/* Notification Types */}
        <div className="space-y-3">
          <h3 className="font-semibold">Tipos de notificación</h3>
          
          {settings.map((setting) => {
            const Icon = setting.icon;
            
            return (
              <div
                key={setting.id}
                className="bg-card rounded-xl border border-border p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">{setting.title}</p>
                      <p className="text-sm text-muted-foreground">{setting.description}</p>
                    </div>
                  </div>
                  <Switch 
                    checked={setting.enabled}
                    onCheckedChange={() => toggleSetting(setting.id)}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Email Notifications */}
        <div className="bg-muted rounded-xl p-4">
          <h3 className="font-semibold mb-2">Notificaciones por email</h3>
          <p className="text-sm text-muted-foreground mb-3">
            También recibirás notificaciones importantes en tu correo electrónico registrado.
          </p>
          <div className="flex items-center justify-between">
            <Label htmlFor="email-notif">Recibir emails</Label>
            <Switch id="email-notif" defaultChecked />
          </div>
        </div>
      </div>
    </PortalMobileLayout>
  );
};

export default PortalNotificaciones;
