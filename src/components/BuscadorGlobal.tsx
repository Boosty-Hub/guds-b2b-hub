import { lazy, Suspense, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { alQuedarLibre } from "@/lib/diferir";

export interface ModuloBuscador { label: string; path: string; seccion: string }

// El diálogo (cmdk + Radix Dialog) se descarga aparte: al acercarse al botón, al abrirlo o cuando el navegador queda
// libre tras la carga. El botón y el atajo están aquí, con la pantalla.
const cargarDialogo = () => import("@/components/BuscadorGlobalDialogo");
const BuscadorGlobalDialogo = lazy(() => cargarDialogo().then((m) => ({ default: m.BuscadorGlobalDialogo })));
const precargar = () => { cargarDialogo().catch(() => { /* se reintenta al abrir */ }); };

/** Buscador global de toda la base (Ctrl/⌘ + K). Respeta permisos y empresa activa (función buscar_global).
 *  `contexto="vendedor"`: enlaces al portal del vendedor y solo sus tipos; `modulos` reemplaza los accesos "Ir a". */
export function BuscadorGlobal({ className, compacto = false, atajo = true, contexto = "admin", modulos }: {
  className?: string; compacto?: boolean; atajo?: boolean; contexto?: "admin" | "vendedor"; modulos?: ModuloBuscador[];
}) {
  const vendedor = contexto === "vendedor";
  const [abierto, setAbierto] = useState(false);
  // El diálogo se monta la primera vez que se abre y queda montado (conserva los recientes y la animación de cierre)
  const [montado, setMontado] = useState(false);
  useEffect(() => { if (abierto) setMontado(true); }, [abierto]);
  useEffect(() => alQuedarLibre(precargar, 1500), []);

  useEffect(() => {
    if (!atajo) return;
    const alTeclear = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setAbierto((v) => !v); }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [atajo]);

  return (
    <>
      <button type="button" onClick={() => setAbierto(true)} onPointerEnter={precargar} onFocus={precargar}
        aria-label={compacto ? "Buscar en toda la base (Ctrl+K)" : undefined} aria-haspopup="dialog"
        className={cn("flex h-8 items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-muted",
          compacto ? "w-8 justify-center px-0" : "w-72", className)}>
        <Search className="h-3.5 w-3.5 shrink-0" />
        {!compacto && <><span className="flex-1 truncate text-left">{vendedor ? "Buscar clientes, pedidos, productos…" : "Buscar clientes, facturas, lotes…"}</span>
          <kbd className="rounded border border-border bg-card px-1 font-mono text-[10px]">Ctrl K</kbd></>}
      </button>

      {(montado || abierto) && (
        <Suspense fallback={null}>
          <BuscadorGlobalDialogo abierto={abierto} setAbierto={setAbierto} contexto={contexto} modulos={modulos} />
        </Suspense>
      )}
    </>
  );
}
