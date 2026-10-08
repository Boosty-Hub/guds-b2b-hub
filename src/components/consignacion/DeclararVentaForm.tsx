import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertTriangle, Loader2, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/contexts/CurrencyContext";

export interface StockConsignacion {
  producto_id: string;
  nombre: string;
  sku: string | null;
  cantidad: number; // disponible para declarar
  comprometido?: number; // reservado en Odoo + declarado en GUDS que aún no se procesa (22b)
  precio?: number | null; // precio para el cliente del almacén (22e): en 0 no se puede declarar
}

/** Lo que se puede declarar en un almacén de consignación: existencia de Odoo menos lo reservado y lo ya declarado (22b). */
export async function cargarStockConsignacion(almacenId: string): Promise<StockConsignacion[]> {
  const { data } = await supabase.rpc("consignacion_disponible", { p_almacen_id: almacenId });
  return ((data as { producto_id: string; nombre: string; sku: string | null; reservado: number; comprometido: number; disponible: number; precio: number | null }[] | null) ?? [])
    .map((r) => ({ producto_id: r.producto_id, nombre: r.nombre, sku: r.sku, cantidad: Number(r.disponible),
      comprometido: Number(r.reservado || 0) + Number(r.comprometido || 0), precio: r.precio == null ? null : Number(r.precio) }));
}

interface Props {
  almacenId: string;
  stock: StockConsignacion[];
  onDeclarado: () => void;
}

/** Formulario para declarar cuánto se vendió de un almacén en consignación (cliente o vendedor).
 *  22e: un producto sin precio para el cliente no se puede declarar (el pedido iría en 0 a Odoo): se avisa y se bloquea el envío. */
export function DeclararVentaForm({ almacenId, stock, onDeclarado }: Props) {
  const { toast } = useToast();
  const { formatPrice } = useCurrency();
  const [cantidades, setCantidades] = useState<Record<string, number>>({});
  const [notas, setNotas] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  const filtrado = useMemo(() => stock.filter((s) =>
    s.nombre.toLowerCase().includes(search.toLowerCase()) || (s.sku || "").toLowerCase().includes(search.toLowerCase())
  ), [stock, search]);

  const setCantidad = (productoId: string, valor: number, disponible: number) => {
    const v = Math.max(0, Math.min(valor, disponible));
    setCantidades((prev) => {
      const next = { ...prev };
      if (v <= 0) delete next[productoId]; else next[productoId] = v;
      return next;
    });
  };

  const items = Object.entries(cantidades).filter(([, c]) => c > 0);
  const sinPrecio = (s: StockConsignacion) => !(Number(s.precio) > 0);
  const elegidosSinPrecio = items.map(([id]) => stock.find((s) => s.producto_id === id)).filter((s): s is StockConsignacion => !!s && sinPrecio(s));
  const total = items.reduce((t, [id, c]) => t + c * (Number(stock.find((s) => s.producto_id === id)?.precio) || 0), 0);

  const declarar = async () => {
    if (items.length === 0) {
      toast({ title: "Agregá al menos un producto vendido", variant: "destructive" });
      return;
    }
    if (elegidosSinPrecio.length) {
      toast({ title: "Hay productos sin precio", description: `Quita ${elegidosSinPrecio.map((s) => s.nombre).join(", ")} o pide a administración que les asigne precio.`, variant: "destructive" });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.rpc("declarar_venta_consignacion", {
      p_almacen_id: almacenId,
      p_items: items.map(([producto_id, cantidad]) => ({ producto_id, cantidad })),
      p_notas: notas || null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "No se pudo declarar la venta", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Declaración enviada", description: "Queda pendiente de revisión. Al aprobarse se crea el pedido y la factura llega cuando se procese." });
    setCantidades({});
    setNotas("");
    onDeclarado();
  };

  return (
    <div className="space-y-4">
      <Input placeholder="Buscar producto por nombre o SKU..." aria-label="Buscar producto por nombre o SKU" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Precio</TableHead>
              <TableHead className="text-right">Disponible</TableHead>
              <TableHead className="w-32 text-right">Vendido</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtrado.map((s) => (
              <TableRow key={s.producto_id} data-sin-precio={sinPrecio(s) || undefined}>
                <TableCell>
                  <p className="font-medium">{s.nombre}</p>
                  {s.sku && <p className="font-mono text-xs text-muted-foreground">{s.sku}</p>}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {sinPrecio(s)
                    ? <span className="text-xs font-medium text-destructive" title="Sin precio para este cliente: no se puede declarar">Sin precio</span>
                    : formatPrice(Number(s.precio))}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {s.cantidad}
                  {!!s.comprometido && s.comprometido > 0 && (
                    <span className="block text-[11px]" title="Reservado en Odoo o declarado y aún sin procesar">{s.comprometido} en proceso</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number" min="0" max={s.cantidad} step="1" className="h-8 text-right" inputMode="numeric" disabled={s.cantidad <= 0}
                    aria-label={`Cantidad vendida de ${s.nombre}`}
                    value={cantidades[s.producto_id] || ""}
                    onChange={(e) => setCantidad(s.producto_id, parseInt(e.target.value) || 0, s.cantidad)}
                  />
                </TableCell>
              </TableRow>
            ))}
            {filtrado.length === 0 && (
              <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Sin productos en consignación.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {elegidosSinPrecio.length > 0 && (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="declarar-sin-precio">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>No se puede declarar:</strong> {elegidosSinPrecio.map((s) => s.nombre).join(", ")} no {elegidosSinPrecio.length === 1 ? "tiene" : "tienen"} precio
            para este cliente. Quítalo{elegidosSinPrecio.length === 1 ? "" : "s"} de la declaración o pide a administración que le{elegidosSinPrecio.length === 1 ? "" : "s"} asigne precio.
          </span>
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="consignacion-notas">Notas (opcional)</Label>
        <Textarea id="consignacion-notas" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Detalle adicional para el administrador..." />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={declarar} disabled={saving || items.length === 0 || elegidosSinPrecio.length > 0} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Declarar venta ({items.length} producto{items.length !== 1 ? "s" : ""})
        </Button>
        {items.length > 0 && <span className="text-xs text-muted-foreground" data-testid="declarar-total">Subtotal {formatPrice(total)} + IVA</span>}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="declarar-ayuda">
        Al aprobarse, la venta se convierte en un pedido; la factura llega cuando se procese.
      </p>
    </div>
  );
}
