import { useEffect, useMemo, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { CamposDireccion, ErrorCampo } from "./CamposDireccion";
import { EstadoEnvioOdoo } from "./EstadoEnvioOdoo";
import {
  direccionPayload, errorTelefonoVe, erroresDireccion, estadoVe, useSeguimientoEscritura, type DireccionForm,
} from "./odooCliente";

export interface ContactoClienteOdoo {
  id: string;
  nombre_negocio: string;
  telefono: string | null;
  celular?: string | null;
  direccion: string | null;
  calle?: string | null;         // street / street2 de Odoo por separado (19y)
  complemento?: string | null;
  ciudad: string | null;
  estado?: string | null;
}

type Form = DireccionForm & { telefono: string; celular: string };

const desdeCliente = (c: ContactoClienteOdoo): Form => ({
  telefono: c.telefono ?? "", celular: c.celular ?? "",
  // Calle y complemento tal como están en Odoo (si la ficha aún no los tiene separados, la dirección completa va en calle)
  calle: c.calle ?? c.direccion ?? "", complemento: c.calle != null ? c.complemento ?? "" : "", ciudad: c.ciudad ?? "", estado: estadoVe(c.estado) ?? "",
});

/** Teléfono, celular y dirección del cliente: se guardan en Odoo (res.partner) y luego en la ficha de GUDS. */
export function EditarContactoClienteDialog({ open, onOpenChange, cliente, onGuardado }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cliente: ContactoClienteOdoo;
  onGuardado: () => void;
}) {
  const { toast } = useToast();
  const [inicial, setInicial] = useState<Form>(() => desdeCliente(cliente));
  const [form, setForm] = useState<Form>(inicial);
  const [intento, setIntento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const seg = useSeguimientoEscritura(cliente.id, (e) => {
    onGuardado();
    if (e.estado === "hecha") toast({ title: "Guardado en Odoo", description: cliente.nombre_negocio });
  });
  const { limpiar } = seg;

  useEffect(() => {
    if (!open) return;
    const f = desdeCliente(cliente);
    setInicial(f); setForm(f); setIntento(false); setErrorEnvio(null); limpiar();
    // Solo al abrir: la ficha se recarga después de guardar y no debe pisar lo que se está viendo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const telCambio = form.telefono.trim() !== inicial.telefono.trim();
  const celCambio = form.celular.trim() !== inicial.celular.trim();
  const dirCambio = (["calle", "complemento", "ciudad", "estado"] as const).some((k) => form[k].trim() !== inicial[k].trim());
  const hayCambios = telCambio || celCambio || dirCambio;

  const errores = useMemo(() => {
    const e: Partial<Record<keyof Form, string>> = {};
    if (telCambio) e.telefono = errorTelefonoVe(form.telefono, "teléfono") ?? undefined;
    if (celCambio) e.celular = errorTelefonoVe(form.celular, "celular", true) ?? undefined;
    if ((telCambio || celCambio) && !form.telefono.trim() && !form.celular.trim()) e.telefono = "Deja al menos un teléfono.";
    if (dirCambio) Object.assign(e, erroresDireccion(form));
    return Object.fromEntries(Object.entries(e).filter(([, v]) => v)) as Partial<Record<keyof Form, string>>;
  }, [form, telCambio, celCambio, dirCambio]);
  const visibles = intento ? errores : {};

  const guardar = async () => {
    setIntento(true);
    setErrorEnvio(null);
    if (!hayCambios || Object.keys(errores).length) return;
    const datos: Record<string, string> = {};
    if (telCambio) datos.telefono = form.telefono.trim();
    if (celCambio) datos.celular = form.celular.trim();
    if (dirCambio) Object.assign(datos, direccionPayload(form));
    setEnviando(true);
    const { data, error } = await supabase.rpc("actualizar_contacto_cliente", { p_cliente_id: cliente.id, p_datos: datos });
    setEnviando(false);
    if (error) { setErrorEnvio(error.message); return; }
    seg.seguir(data as string);
  };

  const enviado = !!seg.id;
  const final = seg.escritura && !["pendiente", "procesando"].includes(seg.escritura.estado);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Teléfonos y dirección</DialogTitle>
          <DialogDescription>
            {cliente.nombre_negocio} · Se guarda primero en Odoo y la ficha de GUDS queda con lo que acepte Odoo.
          </DialogDescription>
        </DialogHeader>

        {enviado ? (
          <EstadoEnvioOdoo escritura={seg.escritura} agotado={seg.agotado} reintentando={seg.reintentando}
            errorConsulta={seg.errorConsulta} onReintentar={seg.reintentar} />
        ) : (
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); guardar(); }} noValidate>
            <div>
              <Label htmlFor="cto-tel">Teléfono</Label>
              <Input id="cto-tel" inputMode="tel" value={form.telefono} maxLength={40} aria-invalid={!!visibles.telefono}
                onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} placeholder="0212-5551234" />
              <ErrorCampo id="cto-tel-e" texto={visibles.telefono} />
            </div>
            <div>
              <Label htmlFor="cto-cel">Celular</Label>
              <Input id="cto-cel" inputMode="tel" value={form.celular} maxLength={40} aria-invalid={!!visibles.celular}
                onChange={(e) => setForm((f) => ({ ...f, celular: e.target.value }))} placeholder="0414-1234567" />
              <ErrorCampo id="cto-cel-e" texto={visibles.celular} />
            </div>
            <CamposDireccion prefijo="cto" valor={form} errores={dirCambio ? visibles : {}}
              onChange={(d) => setForm((f) => ({ ...f, ...d }))} />
            <p className="text-[11px] text-muted-foreground sm:col-span-2">
              Si cambias la dirección, Odoo queda con la calle y el complemento tal como están aquí.
            </p>
            {errorEnvio && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive sm:col-span-2" role="alert">{errorEnvio}</p>}
            <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
          </form>
        )}

        <DialogFooter className="gap-2">
          {!enviado && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={guardar} disabled={enviando || !hayCambios} className="gap-1.5">
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar en Odoo
              </Button>
            </>
          )}
          {enviado && seg.escritura?.estado === "error" && <Button variant="outline" onClick={limpiar}>Corregir datos</Button>}
          {enviado && <Button variant={final ? "default" : "outline"} onClick={() => onOpenChange(false)}>{final ? "Listo" : "Cerrar"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
