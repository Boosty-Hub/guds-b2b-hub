import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

/** Si el usuario entró con una contraseña temporal (creada o restablecida por GUDS), debe crear la suya antes de seguir. */
export function CambioClaveObligatorio() {
  const { user, updateUser, logout } = useAuth();
  const { toast } = useToast();
  const [clave, setClave] = useState("");
  const [repetir, setRepetir] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user?.debe_cambiar_clave) return null;

  const guardar = async () => {
    setError(null);
    if (clave.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (!/[A-Za-z]/.test(clave) || !/\d/.test(clave)) { setError("Usa letras y números."); return; }
    if (clave !== repetir) { setError("Las contraseñas no coinciden."); return; }
    setGuardando(true);
    const { error: e1 } = await supabase.auth.updateUser({ password: clave });
    if (e1) { setGuardando(false); setError(e1.message); return; }
    const { error: e2 } = await supabase.rpc("marcar_clave_cambiada");
    setGuardando(false);
    if (e2) { setError(e2.message); return; }
    updateUser({ debe_cambiar_clave: false });
    toast({ title: "Contraseña creada", description: "Desde ahora entras con tu nueva contraseña." });
  };

  return (
    <Dialog open>
      <DialogContent className="sm:max-w-md [&>button]:hidden" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Crea tu contraseña</DialogTitle>
          <DialogDescription>Entraste con una contraseña temporal. Crea una propia para continuar.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); guardar(); }}>
          <div><Label htmlFor="clave-nueva">Nueva contraseña</Label><Input id="clave-nueva" type="password" autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} autoFocus /></div>
          <div><Label htmlFor="clave-repetir">Repite la contraseña</Label><Input id="clave-repetir" type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">Mínimo 8 caracteres, con letras y números.</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={guardando}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar contraseña</Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => logout()}>Cerrar sesión</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
