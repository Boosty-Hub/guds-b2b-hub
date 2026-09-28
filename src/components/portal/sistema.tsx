import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrency } from "@/contexts/CurrencyContext";
import { claseTono, estadoVisible, type EstadoVisible, type PedidoParaEstado } from "@/components/pedidos/estadoPedido";

// Sistema visual del portal del cliente (F1): neutros, un acento de marca, cifras tabulares, insignias con los tonos del
// contrato de estados (estadoPedido.ts) y estados de carga / vacío coherentes. Sin emojis.

export type Tono = EstadoVisible["tono"];

/** Escritorio (≥ 1024 px): barra lateral, maestro-detalle y paneles laterales. */
export const useEsEscritorio = () => {
  const consulta = "(min-width: 1024px)";
  const [es, setEs] = useState(() => (typeof window !== "undefined" ? window.matchMedia(consulta).matches : false));
  useEffect(() => {
    const mql = window.matchMedia(consulta);
    const cambio = () => setEs(mql.matches);
    mql.addEventListener("change", cambio);
    cambio();
    return () => mql.removeEventListener("change", cambio);
  }, []);
  return es;
};

/** Insignia con un tono del contrato de estados. */
export const PillTono = ({ tono, children, className, testId }: { tono: Tono; children: ReactNode; className?: string; testId?: string }) => (
  <span
    className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5", claseTono[tono], className)}
    data-testid={testId}
  >
    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" aria-hidden />
    {children}
  </span>
);

/** Estado visible del pedido: el mismo contrato para cliente, vendedor y admin. */
export const EstadoPill = ({ pedido, className }: { pedido: PedidoParaEstado; className?: string }) => {
  const e = estadoVisible(pedido);
  return <PillTono tono={e.tono} className={className} testId="estado-pedido">{e.etiqueta}</PillTono>;
};

/** Eje de pago, aparte del estado del pedido. */
export const PillPago = ({ estado, className }: { estado?: string | null; className?: string }) => {
  if (!estado) return null;
  const conf: Record<string, { tono: Tono; etiqueta: string }> = {
    pagado: { tono: "ok", etiqueta: "Pagado" },
    parcial: { tono: "proceso", etiqueta: "Pago parcial" },
    pendiente: { tono: "neutro", etiqueta: "Por pagar" },
  };
  const c = conf[estado];
  if (!c) return null;
  return <PillTono tono={c.tono} className={className}>{c.etiqueta}</PillTono>;
};

/** Monto en la moneda elegida (USD o Bs. a la tasa del día), siempre con cifras tabulares. */
export const Monto = ({ valor, className }: { valor: number | null | undefined; className?: string }) => {
  const { formatPrice } = useCurrency();
  return <span className={cn("tabular-nums", className)}>{valor == null ? "—" : formatPrice(Number(valor))}</span>;
};

/** Fecha corta en español de Venezuela (acepta 'YYYY-MM-DD' o ISO). */
export const fechaCorta = (s: string | null | undefined, conAnio = true) => {
  if (!s) return "—";
  const d = s.length === 10 ? new Date(`${s}T00:00:00`) : new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-VE", { day: "numeric", month: "short", ...(conAnio ? { year: "numeric" } : {}) });
};

/** Número del pedido y, si nació en GUDS y ya pasó a Odoo, el anterior. */
export const NumeroPedido = ({ numero, numeroGuds, className }: { numero: string; numeroGuds?: string | null; className?: string }) => (
  <span className={cn("min-w-0", className)}>
    <span className="font-semibold tabular-nums">{numero}</span>
    {numeroGuds && numeroGuds !== numero && (
      <span className="ml-1.5 text-xs font-normal text-muted-foreground" data-testid="numero-guds">antes {numeroGuds}</span>
    )}
  </span>
);

/** Estado vacío honesto, con acción opcional. */
export const EstadoVacio = ({ icono: Icono, titulo, descripcion, accion, className }: {
  icono: LucideIcon; titulo: string; descripcion?: ReactNode; accion?: ReactNode; className?: string;
}) => (
  <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted/60">
      <Icono className="h-5 w-5 text-muted-foreground" strokeWidth={1.75} />
    </div>
    <p className="font-medium text-foreground">{titulo}</p>
    {descripcion && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{descripcion}</p>}
    {accion && <div className="mt-5">{accion}</div>}
  </div>
);

/** Tarjeta blanca con encabezado opcional (título + acción). */
export const Panel = ({ titulo, descripcion, accion, children, className, cuerpoClassName, as: Tag = "section" }: {
  titulo?: ReactNode; descripcion?: ReactNode; accion?: ReactNode; children: ReactNode; className?: string; cuerpoClassName?: string;
  as?: "section" | "div" | "aside";
}) => (
  <Tag className={cn("rounded-xl border border-border bg-card", className)}>
    {(titulo || accion) && (
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="min-w-0">
          {titulo && <h2 className="text-sm font-semibold text-foreground">{titulo}</h2>}
          {descripcion && <p className="mt-0.5 text-xs text-muted-foreground">{descripcion}</p>}
        </div>
        {accion && <div className="shrink-0">{accion}</div>}
      </div>
    )}
    <div className={cn("p-4 sm:p-5", cuerpoClassName)}>{children}</div>
  </Tag>
);

/** Indicador (KPI) con cifra grande tabular. Si trae href, toda la tarjeta es un enlace. */
export const Kpi = ({ etiqueta, valor, detalle, icono: Icono, href, cargando, alerta, testId, children }: {
  etiqueta: string; valor: ReactNode; detalle?: ReactNode; icono?: LucideIcon; href?: string; cargando?: boolean;
  alerta?: boolean; testId?: string; children?: ReactNode;
}) => {
  const contenido = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[11px] font-medium uppercase text-muted-foreground sm:text-xs sm:tracking-wide">{etiqueta}</p>
        {Icono && <Icono className={cn("hidden h-4 w-4 shrink-0 sm:block", alerta ? "text-destructive" : "text-muted-foreground")} strokeWidth={1.75} aria-hidden />}
      </div>
      {cargando ? (
        <>
          <Skeleton className="mt-3 h-7 w-28" />
          <Skeleton className="mt-2 h-3.5 w-20" />
        </>
      ) : (
        <>
          <p className="mt-2 truncate text-xl font-semibold tabular-nums text-foreground sm:text-2xl" data-testid={testId}>{valor}</p>
          {detalle && <p className={cn("mt-1 truncate text-xs", alerta ? "text-destructive" : "text-muted-foreground")}>{detalle}</p>}
          {children}
        </>
      )}
    </>
  );
  const clase = "block min-w-0 rounded-xl border border-border bg-card p-4 transition-colors";
  return href ? (
    <Link to={href} className={cn(clase, "hover:border-foreground/20 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>{contenido}</Link>
  ) : (
    <div className={clase}>{contenido}</div>
  );
};

/** Pestañas segmentadas (role="tablist"). */
export function Segmentado<T extends string>({ opciones, valor, onCambio, className, etiqueta }: {
  opciones: { valor: T; etiqueta: ReactNode; n?: number }[]; valor: T; onCambio: (v: T) => void; className?: string; etiqueta?: string;
}) {
  return (
    <div className={cn("flex rounded-lg bg-muted p-1", className)} role="tablist" aria-label={etiqueta}>
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          role="tab"
          aria-selected={valor === o.valor}
          onClick={() => onCambio(o.valor)}
          className={cn(
            "flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-center text-sm font-medium leading-tight transition-colors",
            valor === o.valor ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span>
            {o.etiqueta}
            {o.n != null && <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{o.n}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Filas de carga para listas. */
export const SkeletonFilas = ({ n = 4, alto = "h-16", className }: { n?: number; alto?: string; className?: string }) => (
  <div className={cn("space-y-2", className)} aria-busy="true" aria-label="Cargando">
    {Array.from({ length: n }).map((_, i) => <Skeleton key={i} className={cn("w-full rounded-xl", alto)} />)}
  </div>
);

/** Grilla de tarjetas de producto en carga. */
export const SkeletonProductos = ({ n = 8, className }: { n?: number; className?: string }) => (
  <div className={className} aria-busy="true" aria-label="Cargando productos">
    {Array.from({ length: n }).map((_, i) => (
      <div key={i} className="overflow-hidden rounded-xl border border-border bg-card">
        <Skeleton className="aspect-[4/3] w-full rounded-none" />
        <div className="space-y-2 p-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="mt-3 h-6 w-20" />
        </div>
      </div>
    ))}
  </div>
);

/** Selector de moneda: segmentado (escritorio) o botón compacto que alterna (móvil). */
export const SelectorMoneda = ({ compacto = false, className }: { compacto?: boolean; className?: string }) => {
  const { currency, setCurrency } = useCurrency();
  if (compacto) {
    return (
      <button
        type="button"
        onClick={() => setCurrency(currency === "USD" ? "BS" : "USD")}
        className={cn("h-9 min-w-[3.25rem] rounded-md border border-border bg-card px-2 text-xs font-semibold tabular-nums text-foreground hover:bg-muted", className)}
        aria-label={`Moneda: ${currency === "USD" ? "dólares" : "bolívares"}. Cambiar`}
        data-testid="moneda-toggle"
      >
        {currency === "USD" ? "USD" : "Bs."}
      </button>
    );
  }
  return (
    <div className={cn("flex h-9 items-center rounded-md border border-border bg-card p-0.5", className)} role="group" aria-label="Moneda">
      {(["USD", "BS"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={currency === m}
          onClick={() => setCurrency(m)}
          className={cn(
            "h-full rounded px-2.5 text-xs font-semibold transition-colors",
            currency === m ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
          )}
          data-testid={`moneda-${m.toLowerCase()}`}
        >
          {m === "USD" ? "USD" : "Bs."}
        </button>
      ))}
    </div>
  );
};

/** Iniciales para placeholders de marca (nunca emojis): primeras letras de las palabras (se saltan medidas y códigos). */
export const iniciales = (texto: string | null | undefined, n = 2) =>
  (texto ?? "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((p) => /^\p{L}/u.test(p))
    .slice(0, n)
    .map((p) => p.charAt(0).toUpperCase())
    .join("") || "·";

// Unidades de medida de Odoo (vienen en inglés) en el idioma del portal
const UNIDADES: Record<string, string> = {
  units: "Unidad", unit: "Unidad", "unit(s)": "Unidad", dozens: "Docena", dozen: "Docena", kg: "kg", g: "g", l: "L", liters: "Litro",
  litre: "Litro", m: "m", hours: "Hora", days: "Día", pack: "Paquete", box: "Caja",
};
/** Unidad de medida legible ("Units" → "Unidad"). */
export const unidadTexto = (u: string | null | undefined) => (u ? UNIDADES[u.trim().toLowerCase()] ?? u : "");

/** Texto sin acentos y en minúsculas, para buscar. */
export const normalizar = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
