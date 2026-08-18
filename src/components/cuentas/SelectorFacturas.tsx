import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wand2 } from "lucide-react";

export interface FacturaSaldo {
  id: string;
  numero: string;
  fecha_emision: string | null;
  saldo_usd: number;
}

interface SelectorFacturasProps {
  facturas: FacturaSaldo[];
  montoDisponible: number; // USD, lo que trae el pago
  asignaciones: Record<string, number>; // factura_id -> monto asignado (USD)
  onChange: (next: Record<string, number>) => void;
  formatPrice: (n: number) => string;
}

/**
 * Selector MANUAL de facturas para aplicar un cobro (Fase 11): el admin elige
 * a qué facturas va el dinero y cuánto de cada una. Reemplaza el preview FIFO
 * automático de las Fases 6-8.
 */
export function SelectorFacturas({ facturas, montoDisponible, asignaciones, onChange, formatPrice }: SelectorFacturasProps) {
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
    if (!checked) { setMonto(f.id, 0, f.saldo_usd); return; }
    const restante = Math.max(0, Math.round((montoDisponible - asignado) * 100) / 100);
    setMonto(f.id, Math.min(restante, f.saldo_usd), f.saldo_usd);
  };

  const distribuirAutomatico = () => {
    let rest = montoDisponible;
    const next: Record<string, number> = {};
    for (const f of facturas) {
      if (rest <= 0.009) break;
      const aplicado = Math.min(rest, f.saldo_usd);
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
        <p className="text-xs font-medium text-muted-foreground">Elegí a qué facturas va este cobro y cuánto de cada una</p>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={distribuirAutomatico} disabled={montoDisponible <= 0.009}>
          <Wand2 className="h-3.5 w-3.5" /> Distribuir automático
        </Button>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"></TableHead>
              <TableHead>Factura</TableHead>
              <TableHead>Fecha</TableHead>
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
                    <Checkbox checked={monto > 0.009} onCheckedChange={(c) => toggle(f, !!c)} />
                  </TableCell>
                  <TableCell className="font-mono text-sm text-primary">{f.numero}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString("es-VE") : "—"}
                  </TableCell>
                  <TableCell className="text-right">{formatPrice(f.saldo_usd)}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number" min="0" step="0.01" className="h-8 text-right"
                      value={monto || ""}
                      onChange={(e) => setMonto(f.id, parseFloat(e.target.value) || 0, f.saldo_usd)}
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
        {sobrante > 0.009 && <span className="text-muted-foreground">Sobrante (queda como anticipo): <span className="font-semibold">{formatPrice(sobrante)}</span></span>}
        {sobrante < -0.009 && <span className="font-semibold text-destructive">Excede el monto del pago por {formatPrice(-sobrante)}</span>}
      </div>
    </div>
  );
}
