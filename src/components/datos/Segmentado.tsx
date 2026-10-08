import { cn } from "@/lib/utils";

/** Control segmentado compacto (pocas opciones excluyentes: vista, medida, base de días…). */
export function Segmentado<T extends string>({ valor, opciones, onCambio, etiqueta, testId }: {
  valor: T; opciones: { clave: T; texto: string; titulo?: string }[]; onCambio: (v: T) => void; etiqueta: string; testId?: string;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-muted p-0.5 text-[12px]" role="tablist" aria-label={etiqueta} data-testid={testId}>
      {opciones.map((o) => (
        <button key={o.clave} type="button" role="tab" aria-selected={valor === o.clave} onClick={() => onCambio(o.clave)} title={o.titulo}
          data-testid={testId ? `${testId}-${o.clave}` : undefined}
          className={cn("whitespace-nowrap rounded-sm px-2 py-0.5 font-medium", valor === o.clave ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {o.texto}
        </button>
      ))}
    </div>
  );
}
