import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/contexts/CurrencyContext";
import { SelectorFacturas, type FacturaSaldo } from "@/components/cuentas/SelectorFacturas";
import { compressImage } from "@/lib/image";

const MAX_COMPROBANTE_SIZE = 5 * 1024 * 1024;
const ALLOWED_COMPROBANTE_TYPES = ["application/pdf", "image/jpeg", "image/png"];

interface Concepto { id: string; codigo: string | null; concepto: string; porcentaje: number; }

interface Props {
  clienteId: string;
  facturas: FacturaSaldo[];
  permiteComprobante?: boolean; // false para el admin (registro directo, sin subir archivo)
  onDeclarado: () => void;
}

export function DeclararRetencionForm({ clienteId, facturas, permiteComprobante = true, onDeclarado }: Props) {
  const { toast } = useToast();
  const { formatPrice } = useCurrency();
  const [tipo, setTipo] = useState<"iva" | "islr">("iva");
  const [conceptos, setConceptos] = useState<Concepto[]>([]);
  const [conceptoId, setConceptoId] = useState("");
  const [montoTotal, setMontoTotal] = useState("");
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [notas, setNotas] = useState("");
  const [comprobanteFile, setComprobanteFile] = useState<File | null>(null);
  const [asignaciones, setAsignaciones] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("conceptos_retencion_islr").select("id, codigo, concepto, porcentaje").eq("activo", true).order("concepto")
      .then(({ data }) => setConceptos((data as Concepto[]) ?? []));
  }, []);

  const montoDisponible = Number(montoTotal) || 0;

  const uploadComprobante = async (file: File): Promise<string> => {
    const isImage = file.type.startsWith("image/");
    const body = isImage ? await compressImage(file, 1600, 0.85) : file;
    const ext = isImage ? "jpg" : "pdf";
    const path = `retenciones/${clienteId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("documentos").upload(path, body, {
      contentType: isImage ? "image/jpeg" : "application/pdf",
    });
    if (error) throw error;
    return path;
  };

  const handleFile = (file: File | null) => {
    if (!file) return;
    if (!ALLOWED_COMPROBANTE_TYPES.includes(file.type)) {
      toast({ title: "Formato no permitido", description: "Solo se aceptan PDF, JPG o PNG", variant: "destructive" });
      return;
    }
    if (file.size > MAX_COMPROBANTE_SIZE) {
      toast({ title: "Archivo muy grande", description: "El máximo es 5 MB", variant: "destructive" });
      return;
    }
    setComprobanteFile(file);
  };

  const declarar = async () => {
    const items = Object.entries(asignaciones).filter(([, m]) => m > 0);
    if (items.length === 0) {
      toast({ title: "Elegí a qué facturas aplica la retención", variant: "destructive" });
      return;
    }
    if (tipo === "islr" && !conceptoId) {
      toast({ title: "Elegí el concepto de retención ISLR", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      let comprobante_url: string | null = null;
      if (comprobanteFile) comprobante_url = await uploadComprobante(comprobanteFile);

      const { error } = await supabase.rpc("declarar_retencion", {
        p_cliente_id: clienteId,
        p_tipo: tipo,
        p_concepto_islr_id: tipo === "islr" ? conceptoId : null,
        p_items: items.map(([factura_id, monto]) => ({ factura_id, monto })),
        p_comprobante_url: comprobante_url,
        p_numero: numero || null,
        p_fecha: fecha,
        p_notas: notas || null,
      });
      if (error) throw error;

      toast({ title: "Retención declarada", description: "Queda pendiente de revisión por el administrador." });
      setMontoTotal(""); setNumero(""); setNotas(""); setComprobanteFile(null); setAsignaciones({}); setConceptoId("");
      onDeclarado();
    } catch (e) {
      toast({ title: "No se pudo declarar la retención", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Tipo *</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as "iva" | "islr")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="iva">IVA</SelectItem>
              <SelectItem value="islr">ISLR</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {tipo === "islr" && (
          <div className="space-y-2">
            <Label>Concepto *</Label>
            <Select value={conceptoId} onValueChange={setConceptoId}>
              <SelectTrigger><SelectValue placeholder="Elegir concepto" /></SelectTrigger>
              <SelectContent>
                {conceptos.map((c) => <SelectItem key={c.id} value={c.id}>{c.concepto} ({c.porcentaje}%)</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Monto total retenido (USD) *</Label>
          <Input type="number" min="0" step="0.01" value={montoTotal} onChange={(e) => setMontoTotal(e.target.value)} placeholder="0.00" />
        </div>
        <div className="space-y-2">
          <Label>Fecha</Label>
          <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Nº de comprobante (opcional)</Label>
        <Input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Nº del comprobante de retención" />
      </div>

      {permiteComprobante && (
        <div className="space-y-2">
          <Label>Comprobante (PDF/JPG/PNG, opcional)</Label>
          <div className="flex items-center gap-2">
            <Input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} className="flex-1" />
            {comprobanteFile && <Upload className="h-4 w-4 text-success" />}
          </div>
        </div>
      )}

      <SelectorFacturas
        facturas={facturas}
        montoDisponible={montoDisponible}
        asignaciones={asignaciones}
        onChange={setAsignaciones}
        formatPrice={formatPrice}
      />

      <div className="space-y-2">
        <Label>Notas (opcional)</Label>
        <Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
      </div>

      <Button onClick={declarar} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Declarar retención
      </Button>
    </div>
  );
}
