import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CamposDireccion } from "@/components/clientes/CamposDireccion";
import { direccionPayload, erroresDireccion, estadoVe, type DireccionForm } from "@/components/clientes/odooCliente";
import { supabase } from "@/lib/supabase";
import { mostrarEstado } from "@/lib/estados";
import { useToast } from "@/hooks/use-toast";
import type { Tarea } from "./tipos";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * Corrección asistida [escribe en Odoo]: calle, ciudad y estado del contacto del cliente. Prellena con lo que hay y la
 * sugerencia de la base (el estado de Venezuela con el mismo nombre, o la ciudad que aparece en la calle). Dos pasos:
 * editar → confirmar (muestra qué cambia). Va por la cola odoo_escrituras (calidad_corregir_direccion →
 * actualizar_contacto_cliente, 19w): nunca borra nada en Odoo y deja una nota "(GUDS)" en el contacto.
 */
export function CorregirDireccion({ tarea, abierta, onCerrar, onEnviada }: {
  tarea: Tarea | null;
  abierta: boolean;
  onCerrar: () => void;
  onEnviada: (tareaId: string, escrituraId: string) => void;
}) {
  const { toast } = useToast();
  const d = tarea?.detalle ?? {};
  const inicial = useMemo<DireccionForm>(() => ({
    calle: s(d.calle), complemento: s(d.complemento),
    ciudad: s(d.ciudad) || s(d.sugerido?.ciudad),
    estado: estadoVe(s(d.sugerido?.estado)) ?? "",
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [tarea?.id]);
  const [form, setForm] = useState<DireccionForm>(inicial);
  const [paso, setPaso] = useState<"editar" | "confirmar">("editar");
  const [enviando, setEnviando] = useState(false);
  const [intento, setIntento] = useState(false);
  useEffect(() => { setForm(inicial); setPaso("editar"); setIntento(false); }, [inicial, abierta]);

  const errores = erroresDireccion(form);
  const hayErrores = Object.keys(errores).length > 0;
  const cambios = [
    { campo: "Calle", antes: s(d.calle), despues: form.calle.trim() },
    { campo: "Complemento", antes: s(d.complemento), despues: form.complemento.trim() },
    { campo: "Ciudad", antes: s(d.ciudad), despues: form.ciudad.trim() },
    { campo: "Estado", antes: s(d.estado), despues: form.estado },
  ].filter((c) => c.antes.replace(/\s+/g, " ").trim() !== c.despues.replace(/\s+/g, " ").trim());

  const enviar = async () => {
    if (!tarea) return;
    setEnviando(true);
    const { data, error } = await supabase.rpc("calidad_corregir_direccion", { p_tarea: tarea.id, p_datos: direccionPayload(form) });
    setEnviando(false);
    if (error) { toast({ title: "No se pudo enviar a Odoo", description: error.message, variant: "destructive" }); setPaso("editar"); return; }
    toast({ title: "Enviado a Odoo", description: "La tarea se cierra sola cuando Odoo confirma el dato corregido." });
    onEnviada(tarea.id, data as string);
  };

  return (
    <Dialog open={abierta} onOpenChange={(v) => !v && !enviando && onCerrar()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{paso === "editar" ? "Corregir dirección en Odoo" : "Confirmar el cambio en Odoo"}</DialogTitle>
          <DialogDescription>
            {s(d.cliente)}{d.odoo_id ? <> · contacto {s(d.odoo_id)} de Odoo</> : null}
          </DialogDescription>
        </DialogHeader>

        {paso === "editar" ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <CamposDireccion prefijo="calidad-dir" valor={form} onChange={setForm} errores={intento ? errores : {}} disabled={enviando} />
            </div>
            {(d.sugerido?.ciudad || d.sugerido?.estado) && (
              <p className="text-[11px] text-muted-foreground">
                Sugerido por GUDS: {[s(d.sugerido?.ciudad), mostrarEstado(s(d.sugerido?.estado))].filter(Boolean).join(", ")}
                {!d.ciudad && d.sugerido?.ciudad ? " (la ciudad aparece en la calle)" : ""}. Revísalo antes de enviar.
              </p>
            )}
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <p>Se escribirá en el contacto del cliente en Odoo:</p>
            {cambios.length ? (
              <ul className="space-y-1 rounded-md border border-border bg-muted/40 p-2 text-xs">
                {cambios.map((c) => (
                  <li key={c.campo} className="break-words">
                    <span className="text-muted-foreground">{c.campo}:</span>{" "}
                    <span className="text-muted-foreground line-through decoration-muted-foreground/50">{c.antes || "—"}</span> → <span className="font-medium">{c.despues || "—"}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted-foreground">Sin diferencias con lo que GUDS tiene: se reescriben los mismos valores.</p>}
            <p className="flex gap-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs">
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
              Cambia el dato en Odoo (no borra nada) y deja una nota «(GUDS)» con quién y cuándo. Odoo copia la dirección a las personas de contacto del cliente.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {paso === "editar" ? (
            <>
              <Button variant="outline" onClick={onCerrar}>Cancelar</Button>
              <Button onClick={() => { setIntento(true); if (!hayErrores) setPaso("confirmar"); }}>
                Revisar cambio
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setPaso("editar")} disabled={enviando}>Volver</Button>
              <Button onClick={enviar} disabled={enviando}>
                {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}Escribir en Odoo
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
