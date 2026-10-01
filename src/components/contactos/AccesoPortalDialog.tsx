import { useEffect, useState } from "react";
import { Copy, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { errorClave } from "./tipos";

/** Credenciales recién creadas. `password` solo cuando la generó GUDS (una elegida por el admin no se vuelve a mostrar). */
export interface Credenciales { titulo: string; email: string; password: string | null }

/**
 * Dar acceso al portal (crear_acceso_contacto) o cambiar la contraseña de un acceso (restablecer_clave_cliente):
 * contraseña temporal generada por GUDS (debe cambiarla al entrar) o una elegida por el admin, con confirmación, reglas
 * mínimas y la casilla "Pedir cambio al primer ingreso" marcada por defecto. La contraseña no se guarda en ningún lado.
 */
export function AccesoPortalDialog({ open, onOpenChange, contacto, usuarioId, onHecho }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contacto: { id: string; nombre: string; email: string | null };
  /** Con usuario: cambiar la contraseña de ese acceso. Sin él: dar acceso (o reutilizar su usuario anterior). */
  usuarioId?: string | null;
  onHecho: (c: Credenciales) => void;
}) {
  const { toast } = useToast();
  const [modo, setModo] = useState<"generar" | "establecer">("generar");
  const [clave, setClave] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [ver, setVer] = useState(false);
  const [pedirCambio, setPedirCambio] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [intento, setIntento] = useState(false);

  useEffect(() => {
    if (!open) return;
    setModo("generar"); setClave(""); setConfirmacion(""); setVer(false); setPedirCambio(true); setIntento(false);
  }, [open]);

  const error = modo === "establecer" ? errorClave(clave, confirmacion, contacto.email) : null;
  const restablecer = !!usuarioId;

  const confirmar = async () => {
    setIntento(true);
    if (error) return;
    setEnviando(true);
    const password = modo === "establecer" ? clave : null;
    const r = restablecer
      ? await supabase.rpc("restablecer_clave_cliente", { p_usuario_id: usuarioId, p_password: password, p_pedir_cambio: pedirCambio })
      : await supabase.rpc("crear_acceso_contacto", { p_contacto_id: contacto.id, p_password: password, p_pedir_cambio: pedirCambio });
    setEnviando(false);
    if (r.error) { toast({ title: restablecer ? "No se pudo cambiar la contraseña" : "No se pudo dar acceso", description: r.error.message, variant: "destructive" }); return; }
    const generada = restablecer ? (r.data as string | null) : ((r.data as { email: string; password_temporal: string | null }[] | null)?.[0]?.password_temporal ?? null);
    const email = restablecer ? (contacto.email ?? "") : ((r.data as { email: string }[] | null)?.[0]?.email ?? contacto.email ?? "");
    setClave(""); setConfirmacion("");
    onOpenChange(false);
    onHecho({
      titulo: restablecer ? `Nueva contraseña para ${contacto.nombre}` : `Acceso al portal para ${contacto.nombre}`,
      email, password: generada,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!enviando) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{restablecer ? "Cambiar contraseña del portal" : "Dar acceso al portal"}</DialogTitle>
          <DialogDescription>
            {contacto.nombre} entra al portal de clientes con su correo <span className="font-medium text-foreground">{contacto.email}</span>.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={modo} onValueChange={(v) => { setModo(v as "generar" | "establecer"); setIntento(false); }} className="gap-2">
          <Label htmlFor="acc-generar" className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 font-normal has-[[data-state=checked]]:border-primary">
            <RadioGroupItem id="acc-generar" value="generar" className="mt-0.5" />
            <span><span className="block text-sm font-medium">Generar una contraseña temporal</span>
              <span className="text-xs text-muted-foreground">Se muestra una sola vez para que la compartas; al entrar deberá crear la suya.</span></span>
          </Label>
          <Label htmlFor="acc-establecer" className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 font-normal has-[[data-state=checked]]:border-primary">
            <RadioGroupItem id="acc-establecer" value="establecer" className="mt-0.5" />
            <span><span className="block text-sm font-medium">Establecer una contraseña</span>
              <span className="text-xs text-muted-foreground">La eliges tú. GUDS no la guarda ni la vuelve a mostrar.</span></span>
          </Label>
        </RadioGroup>
        {modo === "establecer" && (
          <div className="space-y-2.5">
            <div>
              <Label htmlFor="acc-clave">Contraseña</Label>
              <div className="relative">
                <Input id="acc-clave" type={ver ? "text" : "password"} autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} className="pr-9" />
                <button type="button" onClick={() => setVer((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}>
                  {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Mínimo 8 caracteres, con letras y números.</p>
            </div>
            <div>
              <Label htmlFor="acc-confirmacion">Confirmar contraseña</Label>
              <Input id="acc-confirmacion" type={ver ? "text" : "password"} autoComplete="new-password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }} />
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={pedirCambio} onCheckedChange={(v) => setPedirCambio(v === true)} aria-label="Pedir cambio al primer ingreso" />
              Pedir cambio al primer ingreso
            </label>
            {intento && error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>Cancelar</Button>
          <Button onClick={confirmar} disabled={enviando}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : restablecer ? "Cambiar contraseña" : "Dar acceso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Muestra las credenciales una sola vez (la contraseña solo si la generó GUDS) y un mensaje listo para enviar. */
export function CredencialesDialog({ credenciales, onClose, destino = "portal de clientes de GUDS", quien = "el contacto" }: {
  credenciales: Credenciales | null; onClose: () => void;
  /** A qué entra (texto del mensaje para enviar). */ destino?: string;
  /** Quién recibe el acceso (texto de la ayuda). */ quien?: string;
}) {
  const { toast } = useToast();
  const copiar = async (texto: string) => {
    try { await navigator.clipboard.writeText(texto); toast({ title: "Copiado" }); } catch { toast({ title: "No se pudo copiar", variant: "destructive" }); }
  };
  const c = credenciales;
  const mensaje = c
    ? `Hola, ya tienes acceso al ${destino}.\nEntra en ${window.location.origin}/login\nUsuario: ${c.email}\n`
      + (c.password ? `Contraseña temporal: ${c.password}\nAl entrar se te pedirá crear tu propia contraseña.` : "Tu contraseña te la envío por separado.")
    : "";
  return (
    <Dialog open={!!c} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{c?.titulo}</DialogTitle>
          <DialogDescription>
            {c?.password
              ? `Compártela por un canal privado. Solo se muestra ahora; al entrar, ${quien} deberá crear su propia contraseña.`
              : "Listo. La contraseña que estableciste no se guarda ni se vuelve a mostrar: compártela por un canal privado."}
          </DialogDescription>
        </DialogHeader>
        {c && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="text-xs text-muted-foreground">Usuario</p>
              <p className="flex items-center justify-between gap-2 break-all font-mono">{c.email}
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copiar(c.email)} aria-label="Copiar usuario"><Copy className="h-3.5 w-3.5" /></Button></p>
              {c.password && (
                <>
                  <p className="mt-2 text-xs text-muted-foreground">Contraseña temporal</p>
                  <p className="flex items-center justify-between gap-2 font-mono text-lg" data-testid="clave-temporal">{c.password}
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => copiar(c.password ?? "")} aria-label="Copiar contraseña"><Copy className="h-3.5 w-3.5" /></Button></p>
                </>
              )}
            </div>
            <Button variant="outline" className="w-full gap-2" onClick={() => copiar(mensaje)}><Copy className="h-4 w-4" /> Copiar mensaje para enviar</Button>
          </div>
        )}
        <DialogFooter><Button onClick={onClose}>Listo</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
