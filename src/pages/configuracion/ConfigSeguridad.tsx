import { useState, useEffect } from "react";
import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";

const ConfigSeguridad = () => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [passwords, setPasswords] = useState({
    current: "",
    new: "",
    confirm: "",
  });
  const [config, setConfig] = useState({
    session_expiry: true,
    block_failed_attempts: true,
  });

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    const { data } = await supabase
      .from('configuracion')
      .select('*')
      .in('clave', ['security_session_expiry', 'security_block_failed']);
    
    if (data) {
      data.forEach(item => {
        if (item.clave === 'security_session_expiry') {
          setConfig(prev => ({ ...prev, session_expiry: item.valor === 'true' }));
        }
        if (item.clave === 'security_block_failed') {
          setConfig(prev => ({ ...prev, block_failed_attempts: item.valor === 'true' }));
        }
      });
    }
  };

  const handleChangePassword = async () => {
    if (passwords.new !== passwords.confirm) {
      toast({ title: "Error", description: "Las contraseñas no coinciden", variant: "destructive" });
      return;
    }
    if (passwords.new.length < 6) {
      toast({ title: "Error", description: "La contraseña debe tener al menos 6 caracteres", variant: "destructive" });
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: passwords.new });
    
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Contraseña actualizada", description: "Tu contraseña ha sido cambiada exitosamente" });
      setPasswords({ current: "", new: "", confirm: "" });
    }
    setSaving(false);
  };

  const saveSecurityConfig = async (key: string, value: boolean) => {
    const { error } = await supabase
      .from('configuracion')
      .upsert({
        clave: key,
        valor: String(value),
        tipo: 'boolean',
        descripcion: `Seguridad: ${key}`,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'clave' });
    if (error) {
      toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" });
      return false;
    }
    toast({ title: "Guardado", description: "Configuración actualizada" });
    return true;
  };

  return (
    <ConfiguracionLayout 
      title="Seguridad" 
      description="Configuración de seguridad y acceso"
    >
      <div className="space-y-6">
        <Card className="border-border">
          <CardHeader>
            <CardTitle>Cambiar Contraseña</CardTitle>
            <CardDescription>Actualiza tu contraseña de acceso</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Contraseña Actual</Label>
              <Input 
                id="current-password" 
                type="password" 
                value={passwords.current}
                onChange={(e) => setPasswords(p => ({ ...p, current: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Nueva Contraseña</Label>
              <Input 
                id="new-password" 
                type="password"
                value={passwords.new}
                onChange={(e) => setPasswords(p => ({ ...p, new: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirmar Contraseña</Label>
              <Input 
                id="confirm-password" 
                type="password"
                value={passwords.confirm}
                onChange={(e) => setPasswords(p => ({ ...p, confirm: e.target.value }))}
              />
            </div>
            <Button onClick={handleChangePassword} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Actualizar Contraseña
            </Button>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle>Autenticación de Dos Factores</CardTitle>
            <CardDescription>Añade una capa extra de seguridad a tu cuenta</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Activar 2FA</p>
                <p className="text-sm text-muted-foreground">Usar aplicación de autenticación</p>
              </div>
              <Switch />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">SMS de verificación</p>
                <p className="text-sm text-muted-foreground">Recibir código por mensaje de texto</p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle>Sesiones Activas</CardTitle>
            <CardDescription>Administra las sesiones de tu cuenta</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <p className="font-medium">Chrome en Windows</p>
                  <p className="text-sm text-muted-foreground">Ciudad de México · Activo ahora</p>
                </div>
                <Badge>Esta sesión</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <p className="font-medium">Safari en iPhone</p>
                  <p className="text-sm text-muted-foreground">Ciudad de México · Hace 2 horas</p>
                </div>
                <Button variant="outline" size="sm">Cerrar</Button>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <p className="font-medium">Firefox en MacOS</p>
                  <p className="text-sm text-muted-foreground">Monterrey · Hace 1 día</p>
                </div>
                <Button variant="outline" size="sm">Cerrar</Button>
              </div>
            </div>
            <Button variant="destructive" className="mt-4">Cerrar Todas las Sesiones</Button>
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader>
            <CardTitle>Políticas de Seguridad</CardTitle>
            <CardDescription>Configuración de seguridad del sistema</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Expiración de sesión</p>
                <p className="text-sm text-muted-foreground">Cerrar sesión automáticamente después de inactividad</p>
              </div>
              <Switch 
                checked={config.session_expiry} 
                onCheckedChange={(v) => {
                  setConfig(prev => ({ ...prev, session_expiry: v }));
                  saveSecurityConfig('security_session_expiry', v);
                }} 
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Bloqueo por intentos fallidos</p>
                <p className="text-sm text-muted-foreground">Bloquear cuenta después de 5 intentos fallidos</p>
              </div>
              <Switch 
                checked={config.block_failed_attempts} 
                onCheckedChange={(v) => {
                  setConfig(prev => ({ ...prev, block_failed_attempts: v }));
                  saveSecurityConfig('security_block_failed', v);
                }} 
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </ConfiguracionLayout>
  );
};

export default ConfigSeguridad;
