import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/Logo";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

/** Destino del enlace "Restablecer contraseña" del correo: Supabase abre una sesión de recuperación y aquí se crea la clave nueva. */
const RestablecerClave = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [estado, setEstado] = useState<"esperando" | "listo" | "vencido">("esperando");
  const [clave, setClave] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let activo = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (activo && sesion && (evento === "PASSWORD_RECOVERY" || evento === "SIGNED_IN")) setEstado("listo");
    });
    supabase.auth.getSession().then(({ data }) => { if (activo && data.session) setEstado("listo"); });
    // Sin sesión en unos segundos: el enlace venció, ya se usó o se abrió sin el token.
    const t = setTimeout(() => { if (activo) setEstado((e) => (e === "esperando" ? "vencido" : e)); }, 5000);
    return () => { activo = false; clearTimeout(t); subscription.unsubscribe(); };
  }, []);

  const guardar = async () => {
    setError(null);
    if (clave.length < 8) { setError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (!/[A-Za-z]/.test(clave) || !/\d/.test(clave)) { setError("Usa letras y números."); return; }
    if (clave !== repetir) { setError("Las contraseñas no coinciden."); return; }
    setGuardando(true);
    const { error: e1 } = await supabase.auth.updateUser({ password: clave });
    if (e1) { setGuardando(false); setError(e1.message); return; }
    await supabase.rpc("marcar_clave_cambiada");
    await supabase.auth.signOut();
    setGuardando(false);
    toast({ title: "Contraseña actualizada", description: "Entra con tu correo y tu nueva contraseña." });
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Logo className="h-10 mb-8 text-primary" />
        <h1 className="text-xl font-semibold flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" /> Nueva contraseña</h1>
        {estado === "esperando" && (
          <p className="mt-4 text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Verificando el enlace…</p>
        )}
        {estado === "vencido" && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">El enlace venció o ya se usó. Pide uno nuevo desde "¿Olvidaste tu contraseña?" en la pantalla de acceso.</p>
            <Button asChild className="w-full"><Link to="/login">Ir al acceso</Link></Button>
          </div>
        )}
        {estado === "listo" && (
          <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); guardar(); }}>
            <div><Label htmlFor="rc-clave">Nueva contraseña</Label><Input id="rc-clave" type="password" autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} autoFocus /></div>
            <div><Label htmlFor="rc-repetir">Repite la contraseña</Label><Input id="rc-repetir" type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} /></div>
            <p className="text-xs text-muted-foreground">Mínimo 8 caracteres, con letras y números.</p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={guardando}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar contraseña</Button>
          </form>
        )}
      </div>
    </div>
  );
};

export default RestablecerClave;
