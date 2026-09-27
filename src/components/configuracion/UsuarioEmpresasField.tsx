import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { EmpresaDistintivo } from "@/components/EmpresaSelector";
import { supabase, type Empresa } from "@/lib/supabase";

export interface EmpresasAsignadas {
  ids: string[];
  defecto: string | null;
}

interface UsuarioEmpresasFieldProps {
  empresas: Empresa[];
  value: EmpresasAsignadas;
  onChange: (value: EmpresasAsignadas) => void;
}

// Empresas a las que accede un usuario (multiempresa) y cuál abre por defecto.
export function UsuarioEmpresasField({ empresas, value, onChange }: UsuarioEmpresasFieldProps) {
  const alternar = (id: string, marcado: boolean) => {
    const ids = marcado ? [...value.ids, id] : value.ids.filter((x) => x !== id);
    const defecto = ids.includes(value.defecto ?? "") ? value.defecto : ids[0] ?? null;
    onChange({ ids, defecto });
  };

  return (
    <div className="space-y-2">
      <Label>Empresas *</Label>
      <div className="space-y-1.5 rounded-lg border border-border p-2">
        {empresas.map((e) => {
          const marcado = value.ids.includes(e.id);
          return (
            <div key={e.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
              <Checkbox id={`emp-${e.id}`} checked={marcado} onCheckedChange={(v) => alternar(e.id, v === true)} />
              <label htmlFor={`emp-${e.id}`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <EmpresaDistintivo empresa={e} className="h-5 w-5" />
                <span className="truncate text-sm">{e.nombre_corto}</span>
              </label>
              {marcado && value.ids.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange({ ...value, defecto: e.id })}
                  className={`rounded px-1.5 py-0.5 text-xs ${value.defecto === e.id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {value.defecto === e.id ? "Por defecto" : "Usar por defecto"}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">Solo verá y operará los datos de las empresas marcadas.</p>
    </div>
  );
}

// Reemplaza las empresas asignadas a un usuario.
export async function guardarEmpresasUsuario(usuarioId: string, value: EmpresasAsignadas) {
  const { error: errorBorrar } = await supabase
    .from("usuario_empresas")
    .delete()
    .eq("usuario_id", usuarioId)
    .not("empresa_id", "in", `(${value.ids.join(",") || "00000000-0000-0000-0000-000000000000"})`);
  if (errorBorrar) return errorBorrar;
  if (!value.ids.length) return null;
  const { error } = await supabase.from("usuario_empresas").upsert(
    value.ids.map((id) => ({ usuario_id: usuarioId, empresa_id: id, por_defecto: id === value.defecto })),
    { onConflict: "usuario_id,empresa_id" },
  );
  return error;
}
