import { useEffect, useMemo, useState } from "react";
import { Building2, Check, ChevronsUpDown, Loader2, Truck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { OdooBadge } from "@/components/OdooBadge";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/contexts/PermissionsContext";
import { cn } from "@/lib/utils";
import { RE_CORREO, tipoVinculo, type AccesoPortal, type Contacto, type TipoVinculo } from "./tipos";

export interface VinculoElegido { tipo: TipoVinculo; id: string | null; nombre: string | null }

/** Busca clientes o proveedores (de la empresa activa, por RLS) por nombre, código o RIF */
function SelectorEntidad({ tipo, valor, onCambio, disabled }: {
  tipo: "cliente" | "proveedor"; valor: { id: string; nombre: string } | null; onCambio: (v: { id: string; nombre: string } | null) => void; disabled?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [opciones, setOpciones] = useState<{ id: string; nombre: string; detalle: string }[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    let vigente = true;
    const t = setTimeout(async () => {
      setCargando(true);
      const txt = q.trim().replace(/[%,()]/g, " ").trim();
      const tabla = tipo === "cliente" ? "clientes" : "proveedores";
      const campoNombre = tipo === "cliente" ? "nombre_negocio" : "nombre";
      let consulta = supabase.from(tabla).select(`id, ${campoNombre}, codigo, rif, activo`).order(campoNombre).limit(30);
      if (txt) consulta = consulta.or(`${campoNombre}.ilike.%${txt}%,codigo.ilike.%${txt}%,rif.ilike.%${txt}%`);
      const { data } = await consulta;
      if (!vigente) return;
      setOpciones(((data as Record<string, string | boolean | null>[] | null) ?? []).map((r) => ({
        id: String(r.id), nombre: String(r[campoNombre] ?? ""), detalle: [r.rif, r.codigo, r.activo === false ? "archivado" : null].filter(Boolean).join(" · "),
      })));
      setCargando(false);
    }, 200);
    return () => { vigente = false; clearTimeout(t); };
  }, [q, abierto, tipo]);

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={abierto} disabled={disabled}
          className="h-9 w-full justify-between px-3 font-normal" data-testid={`selector-${tipo}`}>
          <span className={cn("truncate", !valor && "text-muted-foreground")}>{valor?.nombre ?? (tipo === "cliente" ? "Elegir cliente…" : "Elegir proveedor…")}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={`Buscar ${tipo} por nombre, código o RIF…`} value={q} onValueChange={setQ} />
          <CommandList>
            {cargando && <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>}
            {!cargando && <CommandEmpty>Sin resultados.</CommandEmpty>}
            {opciones.map((o) => (
              <CommandItem key={o.id} value={o.id} onSelect={() => { onCambio({ id: o.id, nombre: o.nombre }); setAbierto(false); }}>
                <Check className={cn("mr-2 h-4 w-4", valor?.id === o.id ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1"><span className="block truncate">{o.nombre}</span>
                  {o.detalle && <span className="block truncate text-xs text-muted-foreground">{o.detalle}</span>}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const vacio = { nombre: "", cargo: "", email: "", telefono: "", celular: "", notas: "", es_principal: false };

/**
 * Crear o editar un contacto: datos, notas y a qué cliente o proveedor pertenece (se puede cambiar o dejar suelto).
 * Los contactos que vienen de Odoo solo editan notas, principal y —si en Odoo no tienen empresa— su cliente o proveedor.
 */
export function ContactoFormDialog({ open, onOpenChange, contacto, acceso, vinculoInicial, onGuardado }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contacto: Contacto | null;
  acceso?: AccesoPortal | null;
  /** Para un contacto nuevo desde la ficha de un cliente o proveedor */
  vinculoInicial?: VinculoElegido | null;
  onGuardado: (id: string) => void;
}) {
  const { toast } = useToast();
  const { can } = usePermissions();
  const [form, setForm] = useState({ ...vacio });
  const [vinculo, setVinculo] = useState<VinculoElegido>({ tipo: "suelto", id: null, nombre: null });
  const [guardando, setGuardando] = useState(false);

  // Se rellena solo al abrir (los datos de entrada pueden cambiar de identidad en cada render del padre)
  useEffect(() => {
    if (!open) return;
    if (contacto) {
      setForm({ nombre: contacto.nombre, cargo: contacto.cargo ?? "", email: contacto.email ?? "", telefono: contacto.telefono ?? "",
        celular: contacto.celular ?? "", notas: contacto.notas ?? "", es_principal: contacto.es_principal });
      setVinculo({ tipo: tipoVinculo(contacto), id: contacto.cliente_id ?? contacto.proveedor_id,
        nombre: contacto.cliente?.nombre_negocio ?? contacto.proveedor?.nombre ?? null });
    } else {
      setForm({ ...vacio });
      setVinculo(vinculoInicial ?? { tipo: "suelto", id: null, nombre: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const deOdoo = contacto?.origen === "odoo";
  const vinculoOdoo = deOdoo && contacto?.odoo_padre_id != null;
  const accesoActivo = !!acceso?.activo && !!contacto?.cliente_id && acceso.cliente_id === contacto.cliente_id;
  const pierdeAcceso = accesoActivo && !(vinculo.tipo === "cliente" && vinculo.id === contacto?.cliente_id);
  // Proveedores y sueltos: solo personal con compras o contactos (la base lo valida igual)
  const puedeProveedor = can("compras", "editar") || can("contactos", "editar");
  const puedeSuelto = can("contactos", "editar");
  const set = (k: keyof typeof vacio, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const opcionesVinculo = useMemo(() => [
    { tipo: "cliente" as const, etiqueta: "Cliente", icono: Building2, ok: true },
    { tipo: "proveedor" as const, etiqueta: "Proveedor", icono: Truck, ok: puedeProveedor },
    { tipo: "suelto" as const, etiqueta: "Suelto", icono: UserRound, ok: puedeSuelto },
  ], [puedeProveedor, puedeSuelto]);

  const guardar = async () => {
    const nombre = form.nombre.trim();
    const email = form.email.trim().toLowerCase();
    if (!nombre) { toast({ title: "Falta el nombre del contacto", variant: "destructive" }); return; }
    if (email && !RE_CORREO.test(email)) { toast({ title: "Correo no válido", variant: "destructive" }); return; }
    if (vinculo.tipo !== "suelto" && !vinculo.id) { toast({ title: `Elige el ${vinculo.tipo}`, variant: "destructive" }); return; }
    if (accesoActivo && email !== (contacto?.email ?? "").toLowerCase() && !pierdeAcceso) {
      toast({ title: "El correo es su usuario del portal", description: "Para cambiarlo, desactiva su acceso y vuelve a darlo con el correo nuevo.", variant: "destructive" });
      return;
    }
    setGuardando(true);
    const cliente_id = vinculo.tipo === "cliente" ? vinculo.id : null;
    const proveedor_id = vinculo.tipo === "proveedor" ? vinculo.id : null;
    const principal = vinculo.tipo !== "suelto" && form.es_principal;
    const payload: Record<string, unknown> = deOdoo
      ? { notas: form.notas.trim() || null, es_principal: principal, ...(vinculoOdoo ? {} : { cliente_id, proveedor_id }) }
      : { nombre, cargo: form.cargo.trim() || null, email: email || null, telefono: form.telefono.trim() || null, celular: form.celular.trim() || null,
          notas: form.notas.trim() || null, es_principal: principal, cliente_id, proveedor_id };
    // Un solo principal por cliente o proveedor
    if (principal && vinculo.id) {
      const col = vinculo.tipo === "cliente" ? "cliente_id" : "proveedor_id";
      await supabase.from("cliente_contactos").update({ es_principal: false }).eq(col, vinculo.id).eq("es_principal", true)
        .neq("id", contacto?.id ?? "00000000-0000-0000-0000-000000000000");
    }
    const r = contacto
      ? await supabase.from("cliente_contactos").update(payload).eq("id", contacto.id).select("id").maybeSingle()
      : await supabase.from("cliente_contactos").insert(payload).select("id").single();
    setGuardando(false);
    if (r.error || !r.data) {
      toast({ title: "No se pudo guardar", description: r.error?.message ?? "Sin permiso para este contacto", variant: "destructive" });
      return;
    }
    toast({ title: contacto ? "Contacto actualizado" : "Contacto agregado", description: pierdeAcceso ? `${nombre}: su acceso al portal quedó desactivado` : nombre });
    onOpenChange(false);
    onGuardado((r.data as { id: string }).id);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!guardando) onOpenChange(v); }}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{contacto ? "Editar contacto" : "Nuevo contacto"}{deOdoo && <OdooBadge />}</DialogTitle>
          <DialogDescription>
            {deOdoo ? "Sus datos vienen de Odoo y se editan en Odoo. Aquí puedes cambiar las notas" + (vinculoOdoo ? "." : " y a quién pertenece en GUDS.")
              : "Solo un contacto de un cliente puede tener acceso al portal de clientes."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-1">
          <div className="col-span-2"><Label htmlFor="k-nombre">Nombre y apellido *</Label>
            <Input id="k-nombre" value={form.nombre} disabled={deOdoo} onChange={(e) => set("nombre", e.target.value)} /></div>
          <div className="col-span-2"><Label htmlFor="k-cargo">Cargo</Label>
            <Input id="k-cargo" value={form.cargo} disabled={deOdoo} onChange={(e) => set("cargo", e.target.value)} placeholder="Compras, Administración…" /></div>
          <div className="col-span-2"><Label htmlFor="k-email">Correo {vinculo.tipo === "cliente" && <span className="font-normal text-muted-foreground">(será su usuario del portal)</span>}</Label>
            <Input id="k-email" type="email" value={form.email} disabled={deOdoo || (accesoActivo && !pierdeAcceso)} onChange={(e) => set("email", e.target.value)} />
            {accesoActivo && !pierdeAcceso && <p className="mt-1 text-xs text-muted-foreground">Es su usuario del portal: para cambiarlo, desactiva su acceso primero.</p>}</div>
          <div className="col-span-2 sm:col-span-1"><Label htmlFor="k-tel">Teléfono</Label>
            <Input id="k-tel" value={form.telefono} disabled={deOdoo} onChange={(e) => set("telefono", e.target.value)} /></div>
          <div className="col-span-2 sm:col-span-1"><Label htmlFor="k-cel">Celular</Label>
            <Input id="k-cel" value={form.celular} disabled={deOdoo} onChange={(e) => set("celular", e.target.value)} /></div>

          <fieldset className="col-span-2 space-y-2 rounded-lg border border-border p-2.5" disabled={vinculoOdoo}>
            <legend className="px-1 text-sm font-medium">Pertenece a</legend>
            <ToggleGroup type="single" value={vinculo.tipo} className="grid grid-cols-3 gap-1"
              onValueChange={(v) => { if (v && v !== vinculo.tipo) setVinculo({ tipo: v as TipoVinculo, id: null, nombre: null }); }}>
              {opcionesVinculo.map((o) => (
                <ToggleGroupItem key={o.tipo} value={o.tipo} disabled={!o.ok || vinculoOdoo} className="h-8 gap-1.5 border border-border text-xs data-[state=on]:border-primary data-[state=on]:bg-primary/10"
                  aria-label={o.etiqueta}>
                  <o.icono className="h-3.5 w-3.5" />{o.etiqueta}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {vinculo.tipo !== "suelto" && (
              <SelectorEntidad tipo={vinculo.tipo} disabled={vinculoOdoo} valor={vinculo.id ? { id: vinculo.id, nombre: vinculo.nombre ?? "" } : null}
                onCambio={(v) => setVinculo((x) => ({ ...x, id: v?.id ?? null, nombre: v?.nombre ?? null }))} />
            )}
            {vinculo.tipo === "suelto" && <p className="text-xs text-muted-foreground">Un contacto suelto vive solo en GUDS: no se envía a Odoo ni entra al portal.</p>}
            {vinculoOdoo && <p className="text-xs text-muted-foreground">En Odoo pertenece a esta empresa: el cambio se hace en Odoo.</p>}
            {pierdeAcceso && <p className="text-xs font-medium text-warning" role="alert">Al quitarle el cliente, su acceso al portal se desactiva.</p>}
            {vinculo.tipo !== "suelto" && (
              <label className="flex cursor-pointer items-center justify-between gap-2 pt-1 text-sm">
                Contacto principal
                <Switch checked={form.es_principal} onCheckedChange={(v) => set("es_principal", v)} aria-label="Contacto principal" />
              </label>
            )}
          </fieldset>

          <div className="col-span-2"><Label htmlFor="k-notas">Notas internas</Label>
            <Textarea id="k-notas" rows={2} value={form.notas} onChange={(e) => set("notas", e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>Cancelar</Button>
          <Button onClick={guardar} disabled={guardando}>{guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
