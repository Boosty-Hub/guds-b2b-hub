import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ESTADOS_VE, type DireccionForm } from "./odooCliente";

/** Mensaje de error bajo un campo. */
export function ErrorCampo({ id, texto }: { id: string; texto?: string | null }) {
  return texto ? <p id={id} className="mt-0.5 text-[11px] text-destructive">{texto}</p> : null;
}

/** Calle, complemento, ciudad y estado (así los guarda Odoo: street, street2, city, state_id). */
export function CamposDireccion({ valor, onChange, errores, disabled, prefijo }: {
  valor: DireccionForm;
  onChange: (v: DireccionForm) => void;
  errores: Partial<Record<keyof DireccionForm, string>>;
  disabled?: boolean;
  prefijo: string;
}) {
  const set = (k: keyof DireccionForm) => (v: string) => onChange({ ...valor, [k]: v });
  return (
    <>
      <div className="sm:col-span-2">
        <Label htmlFor={`${prefijo}-calle`}>Calle *</Label>
        <Input id={`${prefijo}-calle`} value={valor.calle} disabled={disabled} maxLength={200} aria-invalid={!!errores.calle}
          aria-describedby={errores.calle ? `${prefijo}-calle-e` : undefined}
          onChange={(e) => set("calle")(e.target.value)} placeholder="Av., calle, edificio, local…" />
        <ErrorCampo id={`${prefijo}-calle-e`} texto={errores.calle} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={`${prefijo}-comp`}>Complemento</Label>
        <Input id={`${prefijo}-comp`} value={valor.complemento} disabled={disabled} maxLength={200}
          onChange={(e) => set("complemento")(e.target.value)} placeholder="Piso, oficina, punto de referencia (opcional)" />
        <ErrorCampo id={`${prefijo}-comp-e`} texto={errores.complemento} />
      </div>
      <div>
        <Label htmlFor={`${prefijo}-ciudad`}>Ciudad *</Label>
        <Input id={`${prefijo}-ciudad`} value={valor.ciudad} disabled={disabled} maxLength={100} aria-invalid={!!errores.ciudad}
          onChange={(e) => set("ciudad")(e.target.value)} />
        <ErrorCampo id={`${prefijo}-ciudad-e`} texto={errores.ciudad} />
      </div>
      <div>
        <Label htmlFor={`${prefijo}-estado`}>Estado *</Label>
        <Select value={valor.estado || undefined} onValueChange={set("estado")} disabled={disabled}>
          <SelectTrigger id={`${prefijo}-estado`} aria-invalid={!!errores.estado}><SelectValue placeholder="Elige el estado" /></SelectTrigger>
          <SelectContent className="max-h-72">
            {ESTADOS_VE.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
        <ErrorCampo id={`${prefijo}-estado-e`} texto={errores.estado} />
      </div>
    </>
  );
}
