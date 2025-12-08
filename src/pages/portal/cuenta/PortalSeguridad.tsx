import { useState } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  ChevronLeft,
  Shield,
  Lock,
  Eye,
  EyeOff,
  Smartphone,
  Loader2,
  Check
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";

const PortalSeguridad = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const handleChangePassword = async () => {
    if (formData.newPassword !== formData.confirmPassword) {
      toast({ title: "Error", description: "Las contraseñas no coinciden", variant: "destructive" });
      return;
    }

    if (formData.newPassword.length < 6) {
      toast({ title: "Error", description: "La contraseña debe tener al menos 6 caracteres", variant: "destructive" });
      return;
    }

    setSaving(true);

    const { error } = await supabase.auth.updateUser({
      password: formData.newPassword
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Éxito", description: "Contraseña actualizada correctamente" });
      setFormData({ currentPassword: "", newPassword: "", confirmPassword: "" });
    }

    setSaving(false);
  };

  return (
    <PortalMobileLayout showHeader={false} showNav={false}>
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold">Seguridad</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-6">
        {/* Security Status */}
        <div className="bg-green-500/10 rounded-xl p-4 flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-green-500/20 flex items-center justify-center">
            <Shield className="h-6 w-6 text-green-500" />
          </div>
          <div>
            <p className="font-semibold text-green-700">Cuenta protegida</p>
            <p className="text-sm text-green-600">Tu cuenta está segura</p>
          </div>
        </div>

        {/* Change Password */}
        <div className="bg-card rounded-xl border border-border p-4 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Cambiar contraseña
          </h3>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Nueva contraseña</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={formData.newPassword}
                  onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                  placeholder="Mínimo 6 caracteres"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Confirmar contraseña</Label>
              <Input
                type={showPassword ? "text" : "password"}
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                placeholder="Repite la contraseña"
              />
            </div>

            <Button 
              className="w-full gap-2" 
              onClick={handleChangePassword}
              disabled={saving || !formData.newPassword || !formData.confirmPassword}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Actualizar contraseña
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Two Factor Auth */}
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                <Smartphone className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">Autenticación de dos factores</p>
                <p className="text-sm text-muted-foreground">Próximamente disponible</p>
              </div>
            </div>
            <Switch disabled />
          </div>
        </div>

        {/* Session Info */}
        <div className="bg-muted rounded-xl p-4">
          <h3 className="font-semibold mb-3">Sesión actual</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium">{user?.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Última actividad</span>
              <span className="font-medium">Ahora</span>
            </div>
          </div>
        </div>
      </div>
    </PortalMobileLayout>
  );
};

export default PortalSeguridad;
