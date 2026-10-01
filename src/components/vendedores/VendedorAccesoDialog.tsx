import { useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { errorClave, RE_CORREO } from "@/components/contactos/tipos";
import { CredencialesDialog, type Credenciales } from "@/components/contactos/AccesoPortalDialog";

/** Lo que el diálogo necesita del vendedor (fila de vendedores_empresa o ficha). */
export interface VendedorAcceso {
  id: string;
  nombre: string;
  apellido: string | null;
  email: string;
  /** Login del usuario de Odoo con el mismo nombre (sugerencia de correo real). */
  odoo_login?: string | null;
}

export const esCorreoRelleno = (email?: string | null) => !!email && /@guds\.test$/i.test(email.trim());

/**
 * Correo real e invitación de un vendedor (0.4, mismo flujo que el acceso de contactos de 20v): se carga su correo real
 * (con la sugerencia del login de Odoo), se genera una contraseña temporal o se establece una, y se muestra un mensaje
 * listo para enviarle. actualizar_acceso_vendedor cambia el correo de entrada, la contraseña y quita bloqueos.
 */
export function VendedorAccesoDialog({ vendedor, onOpenChange, onHecho }: {
  vendedor: VendedorAcceso | null;
  onOpenChange: (v: boolean) => void;
  onHecho?: () => void;
}) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [modo, setModo] = useState<"generar" | "establecer">("generar");
  const [clave, setClave] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [ver, setVer] = useState(false);
  const [pedirCambio, setPedirCambio] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [intento, setIntento] = useState(false);
  const [credenciales, setCredenciales] = useState<Credenciales | null>(null);

  const sugerido = vendedor?.odoo_login && RE_CORREO.test(vendedor.odoo_login) ? vendedor.odoo_login.toLowerCase() : null;
  useEffect(() => {
    if (!vendedor) return;
    setEmail(esCorreoRelleno(vendedor.email) ? "" : vendedor.email);
    setModo("generar"); setClave(""); setConfirmacion(""); setVer(false); setPedirCambio(true); setIntento(false);
  }, [vendedor]);

  const nombre = vendedor ? `${vendedor.nombre} ${vendedor.apellido || ""}`.trim() : "";
  const correo = email.trim().toLowerCase();
  const errorCorreo = !correo ? "Escribe el correo real del vendedor"
    : !RE_CORREO.test(correo) ? "Correo no válido"
    : esCorreoRelleno(correo) ? "Los correos @guds.test son de relleno: usa el real" : null;
  const errorPass = modo === "establecer" ? errorClave(clave, confirmacion, correo) : null;
  const error = errorCorreo ?? errorPass;

  const confirmar = async () => {
    if (!vendedor) return;
    setIntento(true);
    if (error) return;
    setEnviando(true);
    const { data, error: e } = await supabase.rpc("actualizar_acceso_vendedor", {
      p_usuario_id: vendedor.id, p_email: correo, p_password: modo === "establecer" ? clave : null, p_pedir_cambio: pedirCambio,
    });
    setEnviando(false);
    if (e) { toast({ title: "No se pudo actualizar el acceso", description: e.message, variant: "destructive" }); return; }
    const r = (data as { email: string; password_temporal: string | null }[] | null)?.[0];
    setClave(""); setConfirmacion("");
    onOpenChange(false);
    setCredenciales({ titulo: `Acceso de ${nombre}`, email: r?.email ?? correo, password: r?.password_temporal ?? null });
    onHecho?.();
  };

  return (
    <>
      <Dialog open={!!vendedor} onOpenChange={(v) => { if (!enviando) onOpenChange(v); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Correo y acceso del vendedor</DialogTitle>
            <DialogDescription>
              {nombre} entra al portal de vendedores con este correo. Hoy usa <span className="font-mono text-foreground">{vendedor?.email}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="vend-correo">Correo real</Label>
            <Input id="vend-correo" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.com" />
            {sugerido && sugerido !== correo && (
              <p className="text-xs text-muted-foreground">
                En Odoo entra como <button type="button" className="font-mono text-primary hover:underline" onClick={() => setEmail(sugerido)}>{sugerido}</button>
                {" "}· confírmalo con el equipo antes de usarlo.
              </p>
            )}
            {intento && errorCorreo && <p className="text-sm text-destructive" role="alert">{errorCorreo}</p>}
          </div>
          <RadioGroup value={modo} onValueChange={(v) => { setModo(v as "generar" | "establecer"); setIntento(false); }} className="gap-2">
            <Label htmlFor="vend-generar" className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 font-normal has-[[data-state=checked]]:border-primary">
              <RadioGroupItem id="vend-generar" value="generar" className="mt-0.5" />
              <span><span className="block text-sm font-medium">Generar una contraseña temporal</span>
                <span className="text-xs text-muted-foreground">Se muestra una sola vez para que se la envíes; al entrar deberá crear la suya.</span></span>
            </Label>
            <Label htmlFor="vend-establecer" className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 font-normal has-[[data-state=checked]]:border-primary">
              <RadioGroupItem id="vend-establecer" value="establecer" className="mt-0.5" />
              <span><span className="block text-sm font-medium">Establecer una contraseña</span>
                <span className="text-xs text-muted-foreground">La eliges tú. GUDS no la guarda ni la vuelve a mostrar.</span></span>
            </Label>
          </RadioGroup>
          {modo === "establecer" && (
            <div className="space-y-2.5">
              <div>
                <Label htmlFor="vend-clave">Contraseña</Label>
                <div className="relative">
                  <Input id="vend-clave" type={ver ? "text" : "password"} autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} className="pr-9" />
                  <button type="button" onClick={() => setVer((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}>
                    {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Mínimo 8 caracteres, con letras y números.</p>
              </div>
              <div>
                <Label htmlFor="vend-confirmacion">Confirmar contraseña</Label>
                <Input id="vend-confirmacion" type={ver ? "text" : "password"} autoComplete="new-password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }} />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={pedirCambio} onCheckedChange={(v) => setPedirCambio(v === true)} aria-label="Pedir cambio al primer ingreso" />
                Pedir cambio al primer ingreso
              </label>
              {intento && !errorCorreo && errorPass && <p className="text-sm text-destructive" role="alert">{errorPass}</p>}
            </div>
          )}
          <p className="text-xs text-muted-foreground">Se cierran sus sesiones abiertas. El correo de Odoo no cambia: esto es solo el acceso a GUDS.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>Cancelar</Button>
            <Button onClick={confirmar} disabled={enviando}>{enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar y generar invitación"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CredencialesDialog credenciales={credenciales} onClose={() => setCredenciales(null)} destino="portal de vendedores de GUDS" quien="el vendedor" />
    </>
  );
}
