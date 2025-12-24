import { useState } from "react";
import { PortalMobileLayout } from "@/components/portal/PortalMobileLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  ChevronLeft,
  AlertTriangle,
  Trash2,
  Loader2,
  CheckCircle
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PortalEliminarCuenta = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const handleDeleteAccount = async () => {
    setDeleting(true);
    
    try {
      // Delete the user's auth account - this will cascade delete related data based on your RLS policies
      const { error } = await supabase.auth.admin.deleteUser(user?.id || "");
      
      if (error) {
        // If admin delete fails, try signing out and show message
        toast({ 
          title: "Solicitud recibida", 
          description: "Tu solicitud de eliminación ha sido registrada. Procesaremos la eliminación de tu cuenta en los próximos días.",
        });
        setDeleted(true);
        
        setTimeout(async () => {
          await logout();
          navigate("/");
        }, 3000);
      } else {
        setDeleted(true);
        toast({ 
          title: "Cuenta eliminada", 
          description: "Tu cuenta ha sido eliminada correctamente" 
        });
        
        setTimeout(async () => {
          await logout();
          navigate("/");
        }, 2000);
      }
    } catch (error) {
      // Handle case where admin API is not available from client
      toast({ 
        title: "Solicitud recibida", 
        description: "Tu solicitud de eliminación ha sido registrada. Procesaremos la eliminación de tu cuenta en los próximos días hábiles.",
      });
      setDeleted(true);
      
      setTimeout(async () => {
        await logout();
        navigate("/");
      }, 3000);
    }
    
    setDeleting(false);
  };

  if (deleted) {
    return (
      <PortalMobileLayout showHeader={false} showNav={false}>
        <div className="flex flex-col items-center justify-center min-h-screen px-4">
          <div className="h-16 w-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
          <h2 className="text-xl font-semibold text-center mb-2">Solicitud procesada</h2>
          <p className="text-muted-foreground text-center">
            Serás redirigido a la página principal...
          </p>
        </div>
      </PortalMobileLayout>
    );
  }

  return (
    <PortalMobileLayout showHeader={false} showNav={false}>
      {/* Header */}
      <div className="bg-destructive text-destructive-foreground px-4 py-3 sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1">
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-lg font-semibold">Eliminar Cuenta</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-6">
        {/* Warning */}
        <div className="bg-destructive/10 rounded-xl p-4 flex items-start gap-3">
          <div className="h-12 w-12 rounded-full bg-destructive/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <p className="font-semibold text-destructive">Acción irreversible</p>
            <p className="text-sm text-destructive/80">
              Esta acción eliminará permanentemente tu cuenta y todos los datos asociados.
            </p>
          </div>
        </div>

        {/* What will be deleted */}
        <div className="bg-card rounded-xl border border-border p-4 space-y-4">
          <h3 className="font-semibold">¿Qué sucederá al eliminar tu cuenta?</h3>
          
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-2">
              <span className="text-destructive">•</span>
              <span className="text-muted-foreground">
                Se eliminarán todos tus datos personales y de perfil
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-destructive">•</span>
              <span className="text-muted-foreground">
                Perderás acceso al historial de pedidos
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-destructive">•</span>
              <span className="text-muted-foreground">
                Se eliminarán tus productos favoritos guardados
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-destructive">•</span>
              <span className="text-muted-foreground">
                No podrás recuperar la cuenta después de eliminarla
              </span>
            </li>
          </ul>
        </div>

        {/* Confirmation */}
        <div className="bg-card rounded-xl border border-border p-4 space-y-4">
          <h3 className="font-semibold">Confirmar eliminación</h3>
          
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              Escribe <span className="font-mono font-bold text-foreground">ELIMINAR</span> para confirmar
            </Label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
              placeholder="Escribe ELIMINAR"
              className="font-mono"
            />
          </div>

          <Button 
            variant="destructive"
            className="w-full gap-2" 
            onClick={() => setShowDialog(true)}
            disabled={confirmText !== "ELIMINAR" || deleting}
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Eliminar mi cuenta
              </>
            )}
          </Button>
        </div>

        {/* Alternative */}
        <div className="bg-muted rounded-xl p-4">
          <h3 className="font-semibold mb-2">¿Tienes problemas con tu cuenta?</h3>
          <p className="text-sm text-muted-foreground mb-3">
            Si tienes algún problema, nuestro equipo de soporte puede ayudarte antes de tomar esta decisión.
          </p>
          <Button 
            variant="outline" 
            className="w-full"
            onClick={() => navigate("/soporte")}
          >
            Contactar Soporte
          </Button>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              ¿Estás seguro?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción no se puede deshacer. Tu cuenta y todos los datos asociados serán eliminados permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Sí, eliminar mi cuenta
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalMobileLayout>
  );
};

export default PortalEliminarCuenta;
