// Piezas comunes de las pestañas de Reportes (Ventas, Análisis, Histórico Profit)

// Colores por fuente (paleta validada para daltonismo en claro y oscuro): Odoo rojo, Profit azul
const COLOR_FUENTE = { odoo: ["#e34948", "#e66767"], profit: ["#2a78d6", "#3987e5"] } as const;
export const colorFuente = (f: "odoo" | "profit") => {
  const oscuro = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  return COLOR_FUENTE[f][oscuro ? 1 : 0];
};

/** Insignia de los números que incluyen el histórico de Profit */
export function InsigniaProfit({ className }: { className?: string }) {
  return (
    <span title="Incluye el histórico de Profit (solo lectura)"
      className={`inline-flex h-4 shrink-0 items-center gap-1 rounded border border-border px-1 text-[10px] font-medium leading-none text-muted-foreground ${className ?? ""}`}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: colorFuente("profit") }} aria-hidden />Profit
    </span>
  );
}
