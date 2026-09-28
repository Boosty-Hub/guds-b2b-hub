import { useEffect, useState, type FormEvent } from "react";
import { Check, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { PortalPagina } from "@/components/portal/PortalPagina";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

// Seguridad (F6): cambio de contraseña con la contraseña actual (se comprueba antes de cambiarla) y datos reales de la
// sesión. Sin interruptores de maqueta (se retiraron "dos factores" y "cuenta protegida", que no hacían nada).

const reglaClave = (c: string) => c.length >= 8 && /[A-Za-z]/.test(c) && /\d/.test(c);

const PortalSeguridad = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [ver, setVer] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ actual: "", nueva: "", repetir: "" });
  const [ultimoAcceso, setUltimoAcceso] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUltimoAcceso(data.user?.last_sign_in_at ?? null));
  }, []);

  const cambiar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.actual) { setError("Escribe tu contraseña actual."); return; }
    if (!reglaClave(form.nueva)) { setError("La nueva contraseña debe tener al menos 8 caracteres, con letras y números."); return; }
    if (form.nueva !== form.repetir) { setError("Las contraseñas nuevas no coinciden."); return; }
    if (form.nueva === form.actual) { setError("La nueva contraseña debe ser distinta de la actual."); return; }
    if (!user?.email) return;

    setGuardando(true);
    // Se comprueba la contraseña actual antes de cambiarla (evita que alguien con la sesión abierta la cambie)
    const { error: eActual } = await supabase.auth.signInWithPassword({ email: user.email, password: form.actual });
    if (eActual) {
      setGuardando(false);
      setError("La contraseña actual no es correcta.");
      return;
    }
    const { error: eNueva } = await supabase.auth.updateUser({ password: form.nueva });
    setGuardando(false);
    if (eNueva) {
      setError(/should be different/i.test(eNueva.message) ? "La nueva contraseña debe ser distinta de la actual." : "No pudimos cambiar la contraseña. Intenta de nuevo.");
      return;
    }
    setForm({ actual: "", nueva: "", repetir: "" });
    toast({ title: "Contraseña actualizada", description: "Desde ahora entras con tu nueva contraseña." });
  };

  const campo = (id: "actual" | "nueva" | "repetir", etiqueta: string, autoComplete: string, ayuda?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`clave-${id}`}>{etiqueta}</Label>
      <Input id={`clave-${id}`} type={ver ? "text" : "password"} autoComplete={autoComplete} value={form[id]}
        onChange={(e) => setForm({ ...form, [id]: e.target.value })} aria-describedby={ayuda ? `ayuda-${id}` : undefined} />
      {ayuda && <p id={`ayuda-${id}`} className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  );

  return (
    <PortalPagina titulo="Seguridad" volver="/portal/cuenta" etiquetaVolver="Mi cuenta" ancho="estrecho" descripcion="Tu contraseña y tu sesión.">
      <div className="space-y-4 pb-2">
        <form onSubmit={cambiar} className="space-y-4 rounded-xl border border-border bg-card p-4" aria-labelledby="titulo-clave" noValidate>
          <div className="flex items-center justify-between gap-3">
            <h2 id="titulo-clave" className="flex items-center gap-2 font-semibold"><Lock className="h-4 w-4" />Cambiar contraseña</h2>
            <button type="button" onClick={() => setVer(!ver)} className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              aria-pressed={ver}>
              {ver ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{ver ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          {campo("actual", "Contraseña actual", "current-password")}
          {campo("nueva", "Nueva contraseña", "new-password", "Mínimo 8 caracteres, con letras y números.")}
          {campo("repetir", "Repite la nueva contraseña", "new-password")}
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert" data-testid="clave-error">{error}</p>}
          <Button type="submit" className="w-full gap-2" disabled={guardando || !form.actual || !form.nueva || !form.repetir} data-testid="clave-guardar">
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Actualizar contraseña
          </Button>
        </form>

        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="mb-3 font-semibold">Sesión</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Correo de acceso</dt><dd className="min-w-0 truncate font-medium">{user?.email}</dd></div>
            {ultimoAcceso && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Último inicio de sesión</dt>
                <dd className="text-right tabular-nums">{new Date(ultimoAcceso).toLocaleString("es-VE", { dateStyle: "medium", timeStyle: "short" })}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">¿Olvidaste tu contraseña? Cierra sesión y usa «¿Olvidaste tu contraseña?» en la pantalla de acceso.</p>
        </section>
      </div>
    </PortalPagina>
  );
};

export default PortalSeguridad;
