import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Bell, Shield, Palette } from "lucide-react";

const Configuracion = () => {
  return (
    <MainLayout title="Configuración">
      <Tabs defaultValue="empresa" className="space-y-6">
        <TabsList>
          <TabsTrigger value="empresa" className="gap-2">
            <Building2 className="h-4 w-4" />
            Empresa
          </TabsTrigger>
          <TabsTrigger value="notificaciones" className="gap-2">
            <Bell className="h-4 w-4" />
            Notificaciones
          </TabsTrigger>
          <TabsTrigger value="seguridad" className="gap-2">
            <Shield className="h-4 w-4" />
            Seguridad
          </TabsTrigger>
        </TabsList>

        <TabsContent value="empresa" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Información de la Empresa</CardTitle>
              <CardDescription>Datos generales de GUDS Distribuidora</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="company-name">Nombre de la Empresa</Label>
                  <Input id="company-name" defaultValue="GUDS Distribuidora de Alimentos" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ruc">RUC</Label>
                  <Input id="ruc" defaultValue="20123456789" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" defaultValue="contacto@guds.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Teléfono</Label>
                  <Input id="phone" defaultValue="+51 1 234 5678" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="address">Dirección</Label>
                  <Input id="address" defaultValue="Av. Industrial 1234, Lima, Perú" />
                </div>
              </div>
              <Button>Guardar Cambios</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Configuración de Inventario</CardTitle>
              <CardDescription>Ajustes para el manejo de inventario</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Alertas de bajo stock</p>
                  <p className="text-sm text-muted-foreground">Notificar cuando un producto esté por debajo del mínimo</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Permitir stock negativo</p>
                  <p className="text-sm text-muted-foreground">Permitir ventas aunque no haya stock disponible</p>
                </div>
                <Switch />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Reservar stock en órdenes</p>
                  <p className="text-sm text-muted-foreground">Reservar automáticamente el stock al crear una orden</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notificaciones" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Preferencias de Notificación</CardTitle>
              <CardDescription>Configura cómo y cuándo recibir alertas</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Nuevas órdenes</p>
                  <p className="text-sm text-muted-foreground">Notificar cuando llegue una nueva orden</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Pagos recibidos</p>
                  <p className="text-sm text-muted-foreground">Notificar cuando se registre un pago</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Alertas de inventario</p>
                  <p className="text-sm text-muted-foreground">Notificar sobre productos con bajo stock</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Cuentas vencidas</p>
                  <p className="text-sm text-muted-foreground">Notificar sobre pagos pendientes vencidos</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="seguridad" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Cambiar Contraseña</CardTitle>
              <CardDescription>Actualiza tu contraseña de acceso</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Contraseña Actual</Label>
                <Input id="current-password" type="password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">Nueva Contraseña</Label>
                <Input id="new-password" type="password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirmar Contraseña</Label>
                <Input id="confirm-password" type="password" />
              </div>
              <Button>Actualizar Contraseña</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sesiones Activas</CardTitle>
              <CardDescription>Administra las sesiones de tu cuenta</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div>
                    <p className="font-medium">Chrome en Windows</p>
                    <p className="text-sm text-muted-foreground">Lima, Perú · Activo ahora</p>
                  </div>
                  <Button variant="outline" size="sm">Esta sesión</Button>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div>
                    <p className="font-medium">Safari en iPhone</p>
                    <p className="text-sm text-muted-foreground">Lima, Perú · Hace 2 horas</p>
                  </div>
                  <Button variant="outline" size="sm">Cerrar</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default Configuracion;
