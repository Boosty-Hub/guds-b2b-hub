import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEmpresa } from "@/contexts/EmpresaContext";

// Si la empresa activa no tiene clientes del vendedor y otra sí, ofrece cambiar (la empresa por defecto se corrige en
// la base, pero la elección guardada en el navegador manda y la sincronización con Odoo asigna clientes sin avisar).
export function AvisoEmpresaCartera({ clientes, porEmpresa }: { clientes: number; porEmpresa: Record<string, number> | undefined }) {
  const { empresas, empresaActiva, cambiarEmpresa } = useEmpresa();
  if (!empresaActiva || clientes > 0 || !porEmpresa) return null;
  const otra = empresas
    .filter((e) => e.id !== empresaActiva.id && (porEmpresa[e.id] ?? 0) > 0)
    .sort((a, b) => (porEmpresa[b.id] ?? 0) - (porEmpresa[a.id] ?? 0))[0];
  if (!otra) return null;
  const n = porEmpresa[otra.id];
  return (
    <div className="mb-3 flex flex-col gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
      <span>
        No tienes clientes en <strong>{empresaActiva.nombre_corto}</strong>. Tu cartera está en <strong>{otra.nombre_corto}</strong> ({n} {n === 1 ? "cliente" : "clientes"}).
      </span>
      <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1.5 border-amber-400 bg-white/70 text-amber-900 hover:bg-white dark:bg-transparent dark:text-amber-100"
        onClick={() => cambiarEmpresa(otra.id)}>
        <ArrowRightLeft className="h-3.5 w-3.5" />Cambiar a {otra.nombre_corto}
      </Button>
    </div>
  );
}
