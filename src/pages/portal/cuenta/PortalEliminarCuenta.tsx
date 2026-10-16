import { useState } from "react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle,
  Trash2,
  Loader2,
  CheckCircle
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
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
    setShowDialog(false);

    // Cierre real de la cuenta en el servidor: revoca el acceso, desactiva el
    // usuario y limpia carrito/favoritos.
    const { error } = await supabase.rpc("cerrar_mi_cuenta");
    setDeleting(false);

    if (error) {
      toast({
        title: "No se pudo cerrar la cuenta",
        description: error.message || "Intenta de nuevo o contacta a soporte.",
        variant: "destructive",
      });
      return;
    }

    setDeleted(true);
    toast({ title: "Cuenta cerrada", description: "Tu acceso ha sido revocado. Lamentamos verte partir." });
    setTimeout(async () => {
      await logout();
      navigate("/");
    }, 2500);
  };

  if (deleted) {
    return (
      <PortalPagina titulo="Cerrar mi acceso" volver="/portal/cuenta" etiquetaVolver="Mi cuenta" ancho="estrecho">
        <div className="flex flex-col items-center justify-center min-h-screen px-4">
          <div className="h-16 w-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
          <h2 className="text-xl font-semibold text-center mb-2">Solicitud procesada</h2>
          <p className="text-muted-foreground text-center">
            Serás redirigido a la página principal...
          </p>
        </div>
      </PortalPagina>
    );
  }

  return (
    <PortalPagina titulo="Cerrar mi acceso" volver="/portal/cuenta" etiquetaVolver="Mi cuenta" ancho="estrecho">

      <div className="pb-6 space-y-6">
        {/* Warning */}
        <div className="bg-destructive/10 rounded-xl p-4 flex items-start gap-3">
          <div className="h-12 w-12 rounded-full bg-destructive/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <div>
            <p className="font-semibold text-destructive">Acción irreversible</p>
            <p className="text-sm text-destructive">
              Se eliminará tu acceso a Guds Store de forma permanente. Los registros comerciales y fiscales de tu empresa se conservan.
            </p>
          </div>
        </div>

        {/* Lo que hace cerrar_mi_cuenta (supabase/migrations/20260719_fase5b_cerrar_cuenta.sql); /eliminar-cuenta dice lo mismo */}
        <div className="bg-card rounded-xl border border-border p-4 space-y-4">
          <h2 className="font-semibold">¿Qué sucederá al eliminar tu cuenta?</h2>

          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-2">
              <span className="text-destructive" aria-hidden>•</span>
              <span className="text-muted-foreground">
                Se eliminan tu usuario de acceso (correo y contraseña) y tus sesiones: no podrás volver a entrar con él
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-destructive" aria-hidden>•</span>
              <span className="text-muted-foreground">
                Se eliminan tu carrito, tus favoritos y los teléfonos registrados para notificaciones
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-destructive" aria-hidden>•</span>
              <span className="text-muted-foreground">
                Tu ficha de usuario queda desactivada y desvinculada del acceso (conserva tu nombre, correo y teléfono)
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-destructive" aria-hidden>•</span>
              <span className="text-muted-foreground">
                La ficha de tu empresa, sus pedidos, facturas y pagos se conservan por obligaciones legales y fiscales; ya no los verás desde esta cuenta
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-destructive" aria-hidden>•</span>
              <span className="text-muted-foreground">
                No podrás recuperar el acceso después de eliminarlo
              </span>
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Detalle completo en <Link to="/eliminar-cuenta" className="underline underline-offset-2 hover:text-foreground">Eliminar tu cuenta</Link>.
          </p>
        </div>

        {/* Confirmation */}
        <div className="bg-card rounded-xl border border-border p-4 space-y-4">
          <h2 className="font-semibold">Confirmar eliminación</h2>
          
          <div className="space-y-2">
            <Label htmlFor="confirmar-eliminar" className="text-sm text-muted-foreground">
              Escribe <span className="font-mono font-bold text-foreground">ELIMINAR</span> para confirmar
            </Label>
            <Input
              id="confirmar-eliminar"
              autoComplete="off"
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
          <h2 className="font-semibold mb-2">¿Tienes problemas con tu cuenta?</h2>
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
              Esta acción no se puede deshacer. Se eliminará tu acceso de forma permanente; los registros comerciales y fiscales de tu empresa se conservan.
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
    </PortalPagina>
  );
};

export default PortalEliminarCuenta;
