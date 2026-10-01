import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle, FlaskConical, Link2, Loader2, PlusCircle, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import type { RegistroCliente } from "@/contexts/AuthContext";
import { ESTADOS_VE, estadoVe } from "./odooCliente";

/** Respuesta de previsualizar_registro_cliente (migración 20s): qué pasará al aprobar, sin cambiar nada. */
export interface VistaPreviaRegistro {
  accion: "usar_existente" | "enlazar_odoo" | "crear_odoo";
  empresa_id: string | null;
  empresa: string | null;
  empresa_activa: string | null;
  existente: { id: string; nombre: string; rif: string | null; activo: boolean; en_odoo: boolean; coincidencia: "rif" | "nombre"; rif_distinto: boolean } | null;
  odoo: { nombre: string; rif: string | null; tipo: string } | null;
  estado_ve: string | null;
  estado_inferido: boolean;
  rif_valido: boolean;
  email_usado: boolean;
  modo: "simular" | "activo";
}

interface Vendedor { id: string; nombre: string; apellido: string | null }
const SIN_VENDEDOR = "__sin__";

/**
 * Confirmación de la aprobación de un registro: muestra qué pasará (ya existe en GUDS / se enlazará con un contacto de Odoo /
 * se creará en Odoo), pide el estado de Venezuela que Odoo exige y, opcionalmente, el vendedor. Al confirmar llama a `onAprobar`.
 */
export function AprobarRegistroDialog({ registro, open, onOpenChange, onAprobar }: {
  registro: RegistroCliente | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAprobar: (opts: { estado: string | null; vendedorId: string | null }) => Promise<void>;
}) {
  const [vista, setVista] = useState<VistaPreviaRegistro | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [estado, setEstado] = useState("");
  const [vendedorId, setVendedorId] = useState(SIN_VENDEDOR);
  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [aprobando, setAprobando] = useState(false);

  useEffect(() => {
    if (!open || !registro) return;
    let vivo = true;
    setCargando(true); setVista(null); setError(null); setVendedorId(SIN_VENDEDOR);
    (async () => {
      const { data, error: e } = await supabase.rpc("previsualizar_registro_cliente", { p_registro_id: registro.id });
      if (!vivo) return;
      if (e) { setError(e.message); setCargando(false); return; }
      const v = data as VistaPreviaRegistro;
      setVista(v);
      setEstado(estadoVe(v.estado_ve) ?? "");
      setCargando(false);
      // Vendedores de la empresa del registro (opcional; se cargan después de mostrar la vista previa)
      setVendedores([]);
      if (v.empresa_id && v.accion !== "usar_existente") {
        // Vendedores de esa empresa (por su cartera de Odoo; sin usuarios de prueba) — vendedores_empresa, fase 21a
        const { data: vs } = await supabase.rpc("vendedores_empresa");
        const deEmpresa = ((vs ?? []) as (Vendedor & { activo: boolean; empresas: string[] | null })[])
          .filter((x) => x.activo && (x.empresas ?? []).includes(v.empresa_id as string));
        if (vivo) setVendedores(deEmpresa.map(({ id, nombre, apellido }) => ({ id, nombre, apellido })));
      }
    })();
    return () => { vivo = false; };
  }, [open, registro]);

  const existente = vista?.accion === "usar_existente";
  const otraEmpresa = !!vista?.empresa_id && !!vista.empresa_activa && vista.empresa_id !== vista.empresa_activa;
  const sinEmpresa = !!vista && !vista.empresa_activa;
  const faltaEstado = !!vista && !existente && !estado;
  const bloqueo = !vista ? "Cargando…" : vista.email_usado ? `Ya existe una cuenta con el correo ${registro?.email}: no se puede aprobar.`
    : otraEmpresa ? `Este registro es de ${vista.empresa ?? "otra empresa"}: cámbiala en el menú superior para aprobarlo.`
      : sinEmpresa ? "Elige una empresa (no \"Ambas\") en el menú superior para aprobar." : null;

  const aprobar = async () => {
    setAprobando(true);
    try {
      await onAprobar({ estado: existente ? null : estado || null, vendedorId: existente || vendedorId === SIN_VENDEDOR ? null : vendedorId });
    } finally {
      setAprobando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!aprobando) onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>¿Aprobar este registro?</DialogTitle>
          <DialogDescription>
            Se dará acceso al portal a {registro?.nombreContacto || "el solicitante"} de "{registro?.nombreNegocio}" con una contraseña temporal
            que deberás comunicarle (no se envía por email).
          </DialogDescription>
        </DialogHeader>

        {cargando && <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Revisando si el cliente ya existe…</div>}
        {error && <p className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>}

        {vista && (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border border-border bg-muted/30 p-3" data-testid="que-pasara">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Qué pasará</p>
              {vista.accion === "usar_existente" && vista.existente && (
                <div className="flex gap-2">
                  <UserCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="font-medium">Ya existe en GUDS: {vista.existente.nombre}{vista.existente.rif ? ` (${vista.existente.rif})` : ""}</p>
                    <p className="text-xs text-muted-foreground">
                      Coincide por {vista.existente.coincidencia === "rif" ? "RIF" : "nombre"}. No se crea otro cliente: el acceso quedará ligado a ese cliente
                      {vista.existente.en_odoo ? " (ya está en Odoo)." : " (su alta en Odoo sigue en curso)."}
                    </p>
                  </div>
                </div>
              )}
              {vista.accion === "enlazar_odoo" && vista.odoo && (
                <div className="flex gap-2">
                  <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="font-medium">Se creará en GUDS y se enlazará con {vista.odoo.nombre}{vista.odoo.rif ? ` (${vista.odoo.rif})` : ""}</p>
                    <p className="text-xs text-muted-foreground">Ya existe en Odoo como {vista.odoo.tipo} con el mismo RIF: no se crea otro contacto en Odoo.</p>
                  </div>
                </div>
              )}
              {vista.accion === "crear_odoo" && (
                <div className="flex gap-2">
                  <PlusCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="font-medium">Se creará en GUDS y en Odoo ({vista.empresa ?? "empresa activa"}) como cliente nuevo</p>
                    <p className="text-xs text-muted-foreground">
                      Queda marcado "(GUDS)" en Odoo. Antes de crearlo, GUDS vuelve a buscar en Odoo por RIF y nombre: si ya existe, lo enlaza; si hay varias
                      coincidencias, podrás elegir en la ficha del cliente.
                    </p>
                  </div>
                </div>
              )}
              {vista.modo === "simular" && vista.accion !== "usar_existente" && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-warning"><FlaskConical className="h-3.5 w-3.5" /> Modo simulación: GUDS calcula el alta pero no escribe en Odoo.</p>
              )}
            </div>

            {existente && vista.existente?.rif_distinto && (
              <p className="flex gap-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs"><AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                Coincide solo por el nombre y tiene otro RIF: confirma que es el mismo negocio antes de aprobar (el solicitante verá su cuenta).</p>
            )}
            {existente && vista.existente && !vista.existente.activo && (
              <p className="flex gap-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs"><AlertTriangle className="h-4 w-4 shrink-0 text-warning" /> Ese cliente está inactivo.</p>
            )}
            {!existente && !vista.rif_valido && (
              <p className="flex gap-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs"><AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                El RIF "{registro?.rif}" no tiene un formato válido: Odoo no lo aceptará hasta corregirlo en la ficha del cliente.</p>
            )}

            {!existente && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="aprobar-estado" className="text-xs">Estado (Odoo lo exige) *</Label>
                  <Select value={estado} onValueChange={setEstado}>
                    <SelectTrigger id="aprobar-estado" className="h-9"><SelectValue placeholder="Elige el estado" /></SelectTrigger>
                    <SelectContent>{ESTADOS_VE.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                  </Select>
                  {vista.estado_inferido && estado && <p className="text-[11px] text-muted-foreground">Deducido de la dirección o la ciudad: confírmalo.</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="aprobar-vendedor" className="text-xs">Vendedor (opcional)</Label>
                  <Select value={vendedorId} onValueChange={setVendedorId}>
                    <SelectTrigger id="aprobar-vendedor" className="h-9"><SelectValue placeholder="Sin vendedor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SIN_VENDEDOR}>Sin vendedor</SelectItem>
                      {vendedores.map((v) => <SelectItem key={v.id} value={v.id}>{[v.nombre, v.apellido].filter(Boolean).join(" ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">En Odoo queda como su vendedor si tiene usuario con el mismo nombre.</p>
                </div>
              </div>
            )}

            {bloqueo && vista && <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive" role="alert">{bloqueo}</p>}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={aprobando}>Cancelar</Button>
          <Button onClick={aprobar} disabled={aprobando || cargando || !!error || !!bloqueo || faltaEstado} className="bg-green-600 hover:bg-green-700">
            {aprobando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
            {aprobando ? "Aprobando…" : existente ? "Aprobar y ligar al cliente" : "Aprobar cliente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
