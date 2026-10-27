import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wand2 } from "lucide-react";

export interface FacturaSaldo {
  id: string;
  numero: string;
  fecha_emision: string | null;
  /** Saldo en la moneda del selector (USD, o Bs. en un cobro a tasa de emisión). */
  saldo: number;
  /** Tasa Bs/USD de la factura que se muestra (solo cobro a tasa de emisión). */
  tasa?: number;
  tasaEsDeHoy?: boolean;
}

interface SelectorFacturasProps {
  facturas: FacturaSaldo[];
  montoDisponible: number; // lo que trae el pago, en la moneda del selector
  asignaciones: Record<string, number>; // factura_id -> monto asignado, en la moneda del selector
  onChange: (next: Record<string, number>) => void;
  formatPrice: (n: number) => string;
  /** Muestra la columna de tasa: cobro en Bs. a tasa de emisión. */
  conTasa?: boolean;
  /** Textos para otros usos del selector (p. ej. retenciones, donde no hay cobro ni anticipo). */
  instruccion?: string;
  etiquetaSobrante?: string;
}

/**
 * Selector MANUAL de facturas para aplicar un cobro (Fase 11): el admin elige
 * a qué facturas va el dinero y cuánto de cada una. Reemplaza el preview FIFO
 * automático de las Fases 6-8.
 */
export function SelectorFacturas({ facturas, montoDisponible, asignaciones, onChange, formatPrice, conTasa = false,
  instruccion = "Elegí a qué facturas va este cobro y cuánto de cada una", etiquetaSobrante = "Sobrante (queda como anticipo)" }: SelectorFacturasProps) {
  const asignado = Object.values(asignaciones).reduce((s, v) => s + (Number(v) || 0), 0);
  const sobrante = Math.round((montoDisponible - asignado) * 100) / 100;

  const setMonto = (facturaId: string, monto: number, saldo: number) => {
    const next = { ...asignaciones };
    const v = Math.max(0, Math.min(monto, saldo));
    if (v <= 0.009) delete next[facturaId];
    else next[facturaId] = Math.round(v * 100) / 100;
    onChange(next);
  };

  const toggle = (f: FacturaSaldo, checked: boolean) => {
    if (!checked) { setMonto(f.id, 0, f.saldo); return; }
    const restante = Math.max(0, Math.round((montoDisponible - asignado) * 100) / 100);
    setMonto(f.id, Math.min(restante, f.saldo), f.saldo);
  };

  const distribuirAutomatico = () => {
    let rest = montoDisponible;
    const next: Record<string, number> = {};
    for (const f of facturas) {
      if (rest <= 0.009) break;
      const aplicado = Math.min(rest, f.saldo);
      if (aplicado > 0.009) { next[f.id] = Math.round(aplicado * 100) / 100; rest = Math.round((rest - aplicado) * 100) / 100; }
    }
    onChange(next);
  };

  if (facturas.length === 0) {
    return <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">Este cliente no tiene facturas con saldo pendiente.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">{instruccion}</p>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={distribuirAutomatico} disabled={montoDisponible <= 0.009}>
          <Wand2 className="h-3.5 w-3.5" /> Distribuir automático
        </Button>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><span className="sr-only">Incluir</span></TableHead>
              <TableHead>Factura</TableHead>
              <TableHead>Fecha</TableHead>
              {conTasa && <TableHead className="text-right">Tasa emisión</TableHead>}
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="w-36 text-right">Aplicar</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {facturas.map((f) => {
              const monto = asignaciones[f.id] || 0;
              return (
                <TableRow key={f.id}>
                  <TableCell>
                    <Checkbox checked={monto > 0.009} onCheckedChange={(c) => toggle(f, !!c)} aria-label={`Incluir la factura ${f.numero}`} />
                  </TableCell>
                  <TableCell className="font-mono text-sm text-primary">{f.numero}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString("es-VE") : "—"}
                  </TableCell>
                  {conTasa && (
                    <TableCell className="text-right text-muted-foreground">
                      {f.tasa ? f.tasa.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                      {f.tasaEsDeHoy && <span className="block text-[11px]">del día (factura en USD)</span>}
                    </TableCell>
                  )}
                  <TableCell className="text-right">{formatPrice(f.saldo)}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number" min="0" step="0.01" className="h-8 text-right" inputMode="decimal"
                      aria-label={`Monto a aplicar a la factura ${f.numero}`}
                      value={monto || ""}
                      onChange={(e) => setMonto(f.id, parseFloat(e.target.value) || 0, f.saldo)}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
        <span>Asignado: <span className="font-semibold">{formatPrice(asignado)}</span> de {formatPrice(montoDisponible)}</span>
        {sobrante > 0.009 && <span className="text-muted-foreground">{etiquetaSobrante}: <span className="font-semibold">{formatPrice(sobrante)}</span></span>}
        {sobrante < -0.009 && <span className="font-semibold text-destructive">Excede el monto del pago por {formatPrice(-sobrante)}</span>}
      </div>
    </div>
  );
}
