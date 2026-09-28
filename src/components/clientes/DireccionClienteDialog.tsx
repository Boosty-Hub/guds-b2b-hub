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

export interface DireccionEntrega {
  id: string;
  odoo_id: number | null;
  nombre: string | null;
  direccion: string | null;
  calle?: string | null;         // street / street2 de Odoo por separado (19y)
  complemento?: string | null;
  ciudad: string | null;
  estado: string | null;
  telefono: string | null;
}

type Form = DireccionForm & { nombre: string; telefono: string };

/**
 * Dirección de entrega del cliente (dirección hija en Odoo). Sin `direccion`, crea una nueva en Odoo (type "delivery").
 * El nombre de una dirección existente se cambia en Odoo.
 */
export function DireccionClienteDialog({ open, onOpenChange, clienteId, clienteNombre, direccion, porDefecto, nombresUsados, onGuardado }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clienteId: string;
  clienteNombre: string;
  direccion: DireccionEntrega | null;
  /** Ciudad y estado del cliente, para arrancar una dirección nueva */
  porDefecto: { ciudad: string | null; estado: string | null };
  nombresUsados: string[];
  onGuardado: () => void;
}) {
  const { toast } = useToast();
  const nueva = !direccion;
  const vacio = (): Form => direccion
    ? { nombre: direccion.nombre ?? "", calle: direccion.calle ?? direccion.direccion ?? "", complemento: direccion.calle != null ? direccion.complemento ?? "" : "", ciudad: direccion.ciudad ?? "",
        estado: estadoVe(direccion.estado) ?? "", telefono: direccion.telefono ?? "" }
    : { nombre: "", calle: "", complemento: "", ciudad: porDefecto.ciudad ?? "", estado: estadoVe(porDefecto.estado) ?? "", telefono: "" };
  const [inicial, setInicial] = useState<Form>(vacio);
  const [form, setForm] = useState<Form>(inicial);
  const [intento, setIntento] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const seg = useSeguimientoEscritura(clienteId, (e) => {
    onGuardado();
    if (e.estado === "hecha") toast({ title: nueva ? "Dirección creada en Odoo" : "Dirección guardada en Odoo", description: form.nombre || clienteNombre });
  });
  const { limpiar } = seg;

  useEffect(() => {
    if (!open) return;
    const f = vacio();
    setInicial(f); setForm(f); setIntento(false); setErrorEnvio(null); limpiar();
    // Solo al abrir (o al cambiar de dirección)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, direccion?.id]);

  const telCambio = form.telefono.trim() !== inicial.telefono.trim();
  const dirCambio = nueva || (["calle", "complemento", "ciudad", "estado"] as const).some((k) => form[k].trim() !== inicial[k].trim());
  const hayCambios = nueva || telCambio || dirCambio;

  const errores = useMemo(() => {
    const e: Partial<Record<keyof Form, string>> = {};
    if (nueva) {
      const n = form.nombre.trim();
      if (n.length < 2) e.nombre = "Ponle un nombre (p. ej. \"Sucursal Centro\").";
      else if (n.length > 100) e.nombre = "Máximo 100 caracteres.";
      else if (nombresUsados.some((x) => x.trim().toLowerCase() === n.toLowerCase())) e.nombre = "El cliente ya tiene una dirección con ese nombre.";
    }
    if (telCambio) e.telefono = errorTelefonoVe(form.telefono, "teléfono") ?? undefined;
    if (dirCambio) Object.assign(e, erroresDireccion(form));
    return Object.fromEntries(Object.entries(e).filter(([, v]) => v)) as Partial<Record<keyof Form, string>>;
  }, [form, nueva, telCambio, dirCambio, nombresUsados]);
  const visibles = intento ? errores : {};

  const guardar = async () => {
    setIntento(true);
    setErrorEnvio(null);
    if (!hayCambios || Object.keys(errores).length) return;
    const datos: Record<string, string> = {};
    if (nueva) datos.nombre = form.nombre.trim();
    if (telCambio || (nueva && form.telefono.trim())) datos.telefono = form.telefono.trim();
    if (dirCambio) Object.assign(datos, direccionPayload(form));
    setEnviando(true);
    const { data, error } = await supabase.rpc("guardar_direccion_cliente", {
      p_cliente_id: clienteId, p_direccion_id: direccion?.id ?? null, p_datos: datos,
    });
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
          <DialogTitle>{nueva ? "Nueva dirección de entrega" : `Dirección: ${direccion?.nombre || "sin nombre"}`}</DialogTitle>
          <DialogDescription>
            {clienteNombre} · {nueva ? "Se crea en Odoo como dirección de entrega del cliente" : "Se guarda primero en Odoo"} y luego queda en GUDS.
          </DialogDescription>
        </DialogHeader>

        {enviado ? (
          <EstadoEnvioOdoo escritura={seg.escritura} agotado={seg.agotado} reintentando={seg.reintentando}
            errorConsulta={seg.errorConsulta} onReintentar={seg.reintentar} />
        ) : (
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); guardar(); }} noValidate>
            {nueva && (
              <div className="sm:col-span-2">
                <Label htmlFor="dir-nombre">Nombre *</Label>
                <Input id="dir-nombre" value={form.nombre} maxLength={100} aria-invalid={!!visibles.nombre}
                  onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))} placeholder="Sucursal Centro, Almacén, Farmacia 2…" />
                <ErrorCampo id="dir-nombre-e" texto={visibles.nombre} />
              </div>
            )}
            <CamposDireccion prefijo="dir" valor={form} errores={dirCambio ? visibles : {}}
              onChange={(d) => setForm((f) => ({ ...f, ...d }))} />
            <div>
              <Label htmlFor="dir-tel">Teléfono</Label>
              <Input id="dir-tel" inputMode="tel" value={form.telefono} maxLength={40} aria-invalid={!!visibles.telefono}
                onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))} placeholder="0414-1234567" />
              <ErrorCampo id="dir-tel-e" texto={visibles.telefono} />
            </div>
            {!nueva && (
              <p className="text-[11px] text-muted-foreground sm:col-span-2">
                Si cambias la dirección, Odoo queda con la calle y el complemento tal como están aquí.
              </p>
            )}
            {errorEnvio && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive sm:col-span-2" role="alert">{errorEnvio}</p>}
            <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
          </form>
        )}

        <DialogFooter className="gap-2">
          {!enviado && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={guardar} disabled={enviando || !hayCambios} className="gap-1.5">
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {nueva ? "Crear en Odoo" : "Guardar en Odoo"}
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
