import { PortalLayout } from "@/components/portal/PortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Building2, User, MapPin, Bell, Lock, Mail, Phone } from "lucide-react";

const PortalCuenta = () => {
  return (
    <PortalLayout title="Mi Cuenta">
      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">Perfil</TabsTrigger>
          <TabsTrigger value="company">Empresa</TabsTrigger>
          <TabsTrigger value="notifications">Notificaciones</TabsTrigger>
          <TabsTrigger value="security">Seguridad</TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Información Personal
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center gap-6">
                <div className="h-20 w-20 rounded-full bg-primary/20 flex items-center justify-center">
                  <span className="text-2xl font-bold text-primary">JR</span>
                </div>
                <Button variant="outline">Cambiar Foto</Button>
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Nombre</Label>
                  <Input defaultValue="Juan" />
                </div>
                <div className="space-y-2">
                  <Label>Apellido</Label>
                  <Input defaultValue="Rodríguez" />
                </div>
                <div className="space-y-2">
                  <Label>Correo Electrónico</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input defaultValue="juan.rodriguez@walmart.com" className="pl-9" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Teléfono</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input defaultValue="+52 55 1234 5678" className="pl-9" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Cargo</Label>
                  <Input defaultValue="Comprador Senior" />
                </div>
                <div className="space-y-2">
                  <Label>Departamento</Label>
                  <Input defaultValue="Compras" />
                </div>
              </div>

              <div className="flex justify-end">
                <Button>Guardar Cambios</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Company Tab */}
        <TabsContent value="company">
          <div className="space-y-6">
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Información de la Empresa
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Razón Social</Label>
                    <Input defaultValue="Walmart de México S.A.B. de C.V." disabled />
                  </div>
                  <div className="space-y-2">
                    <Label>RFC</Label>
                    <Input defaultValue="WME880914XXX" disabled />
                  </div>
                  <div className="space-y-2">
                    <Label>Giro Comercial</Label>
                    <Input defaultValue="Retail / Supermercados" disabled />
                  </div>
                  <div className="space-y-2">
                    <Label>Lista de Precios Asignada</Label>
                    <Input defaultValue="Mayorista Premium" disabled />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5" />
                  Sedes Asignadas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    { name: "Sede Centro", address: "Av. Insurgentes Sur 123, CDMX", primary: true },
                    { name: "Sede Norte", address: "Blvd. Manuel Ávila Camacho 456, CDMX", primary: false },
                    { name: "Sede Poniente", address: "Av. Santa Fe 789, CDMX", primary: false },
                  ].map((sede, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-4 rounded-lg border border-border"
                    >
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                          <MapPin className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium text-foreground">
                            {sede.name}
                            {sede.primary && (
                              <span className="ml-2 text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
                                Principal
                              </span>
                            )}
                          </p>
                          <p className="text-sm text-muted-foreground">{sede.address}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Preferencias de Notificaciones
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Confirmación de Pedidos</p>
                    <p className="text-sm text-muted-foreground">
                      Recibir notificación cuando un pedido sea confirmado
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Actualizaciones de Envío</p>
                    <p className="text-sm text-muted-foreground">
                      Recibir actualizaciones del estado de envío
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Recordatorios de Pago</p>
                    <p className="text-sm text-muted-foreground">
                      Recibir recordatorios de facturas próximas a vencer
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Promociones y Ofertas</p>
                    <p className="text-sm text-muted-foreground">
                      Recibir información sobre ofertas especiales
                    </p>
                  </div>
                  <Switch />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">Notificaciones por SMS</p>
                    <p className="text-sm text-muted-foreground">
                      Recibir notificaciones importantes por mensaje de texto
                    </p>
                  </div>
                  <Switch />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5" />
                Seguridad de la Cuenta
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Contraseña Actual</Label>
                  <Input type="password" placeholder="••••••••" />
                </div>
                <div className="space-y-2">
                  <Label>Nueva Contraseña</Label>
                  <Input type="password" placeholder="••••••••" />
                </div>
                <div className="space-y-2">
                  <Label>Confirmar Nueva Contraseña</Label>
                  <Input type="password" placeholder="••••••••" />
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-foreground">Autenticación de Dos Factores</p>
                  <p className="text-sm text-muted-foreground">
                    Añade una capa extra de seguridad a tu cuenta
                  </p>
                </div>
                <Button variant="outline">Configurar</Button>
              </div>

              <Separator />

              <div className="flex justify-end">
                <Button>Actualizar Contraseña</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PortalLayout>
  );
};

export default PortalCuenta;
