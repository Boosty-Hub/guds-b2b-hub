import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

export interface StockConsignacion {
  producto_id: string;
  nombre: string;
  sku: string | null;
  cantidad: number; // disponible
}

interface Props {
  almacenId: string;
  stock: StockConsignacion[];
  onDeclarado: () => void;
}

/** Formulario para declarar cuánto se vendió de un almacén en consignación (cliente o vendedor). */
export function DeclararVentaForm({ almacenId, stock, onDeclarado }: Props) {
  const { toast } = useToast();
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

  const declarar = async () => {
    if (items.length === 0) {
      toast({ title: "Agregá al menos un producto vendido", variant: "destructive" });
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
    toast({ title: "Declaración enviada", description: "Queda pendiente de revisión por el administrador." });
    setCantidades({});
    setNotas("");
    onDeclarado();
  };

  return (
    <div className="space-y-4">
      <Input placeholder="Buscar producto por nombre o SKU..." value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead className="text-right">Disponible</TableHead>
              <TableHead className="w-32 text-right">Vendido</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtrado.map((s) => (
              <TableRow key={s.producto_id}>
                <TableCell>
                  <p className="font-medium">{s.nombre}</p>
                  {s.sku && <p className="font-mono text-xs text-muted-foreground">{s.sku}</p>}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{s.cantidad}</TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number" min="0" max={s.cantidad} step="1" className="h-8 text-right"
                    value={cantidades[s.producto_id] || ""}
                    onChange={(e) => setCantidad(s.producto_id, parseInt(e.target.value) || 0, s.cantidad)}
                  />
                </TableCell>
              </TableRow>
            ))}
            {filtrado.length === 0 && (
              <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">Sin productos en consignación.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="space-y-2">
        <Label>Notas (opcional)</Label>
        <Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Detalle adicional para el administrador..." />
      </div>
      <Button onClick={declarar} disabled={saving || items.length === 0} className="gap-2">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Declarar venta ({items.length} producto{items.length !== 1 ? "s" : ""})
      </Button>
    </div>
  );
}
