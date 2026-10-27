import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Send, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useCurrency } from "@/contexts/CurrencyContext";
import { SelectorFacturas } from "@/components/cuentas/SelectorFacturas";
import { facturasParaSelector, resumirCobroBs, tasaEmision, formatoBs, type FacturaCobrable } from "@/components/cuentas/cobroBs";
import { compressImage } from "@/lib/image";

const MAX_COMPROBANTE_SIZE = 5 * 1024 * 1024;
const ALLOWED_COMPROBANTE_TYPES = ["application/pdf", "image/jpeg", "image/png"];

interface Concepto { id: string; codigo: string | null; concepto: string; porcentaje: number; }

interface Props {
  clienteId: string;
  facturas: FacturaCobrable[];
  permiteComprobante?: boolean; // false para el admin (registro directo, sin subir archivo)
  onDeclarado: () => void;
}

export function DeclararRetencionForm({ clienteId, facturas, permiteComprobante = true, onDeclarado }: Props) {
  const { toast } = useToast();
  const { formatPrice, exchangeRate } = useCurrency();
  const [tipo, setTipo] = useState<"iva" | "islr">("iva");
  const [conceptos, setConceptos] = useState<Concepto[]>([]);
  const [conceptoId, setConceptoId] = useState("");
  const [montoTotal, setMontoTotal] = useState("");
  const [numero, setNumero] = useState("");
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [notas, setNotas] = useState("");
  const [comprobanteFile, setComprobanteFile] = useState<File | null>(null);
  const [asignaciones, setAsignaciones] = useState<Record<string, number>>({});
  // Los comprobantes de retención vienen en Bs. (PEN-14773): cada factura en Bs. se convierte con su tasa de emisión;
  // las facturas en USD, con la tasa que indique el comprobante.
  const [enBs, setEnBs] = useState(true);
  const [tasaUsd, setTasaUsd] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from("conceptos_retencion_islr").select("id, codigo, concepto, porcentaje").eq("activo", true).order("concepto")
      .then(({ data }) => setConceptos((data as Concepto[]) ?? []));
  }, []);

  useEffect(() => {
    if (exchangeRate > 0) setTasaUsd((t) => t || Math.round(exchangeRate * 100) / 100);
  }, [exchangeRate]);

  const montoDisponible = Number(montoTotal) || 0;
  const hayFacturasUsd = facturas.some((f) => !tasaEmision(f));
  const facturasSelector = useMemo(() => facturasParaSelector(facturas, enBs, tasaUsd), [facturas, enBs, tasaUsd]);
  const resumenBs = useMemo(
    () => (enBs ? resumirCobroBs(montoDisponible, asignaciones, facturas, tasaUsd) : null),
    [enBs, montoDisponible, asignaciones, facturas, tasaUsd],
  );
  const aplicadoUsd = resumenBs ? Object.values(resumenBs.asignacionesUsd).reduce((t, v) => t + v, 0) : 0;

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
    const items = Object.entries(resumenBs ? resumenBs.asignacionesUsd : asignaciones).filter(([, m]) => m > 0);
    if (items.length === 0) {
      toast({ title: "Elegí a qué facturas aplica la retención", variant: "destructive" });
      return;
    }
    const asignadoBs = Object.values(asignaciones).reduce((t, v) => t + v, 0);
    if (enBs && Math.abs(asignadoBs - montoDisponible) > 0.01) {
      toast({ title: "Los montos no cuadran", description: `Lo asignado a las facturas (${formatoBs(asignadoBs)}) debe ser igual al monto del comprobante (${formatoBs(montoDisponible)}).`, variant: "destructive" });
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
        p_notas: [notas.trim(), resumenBs ? `Comprobante en Bs.: ${formatoBs(montoDisponible)} (cada factura convertida con su tasa).` : ""].filter(Boolean).join(" · ") || null,
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
          <Label htmlFor="retencion-tipo">Tipo *</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as "iva" | "islr")}>
            <SelectTrigger id="retencion-tipo" aria-label="Tipo de retención"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="iva">IVA</SelectItem>
              <SelectItem value="islr">ISLR</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {tipo === "islr" && (
          <div className="space-y-2">
            <Label htmlFor="retencion-concepto">Concepto *</Label>
            <Select value={conceptoId} onValueChange={setConceptoId}>
              <SelectTrigger id="retencion-concepto" aria-label="Concepto de ISLR"><SelectValue placeholder="Elegir concepto" /></SelectTrigger>
              <SelectContent>
                {conceptos.map((c) => <SelectItem key={c.id} value={c.id}>{c.concepto} ({c.porcentaje}%)</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="retencion-monto">Monto total retenido ({enBs ? "Bs." : "USD"}) *</Label>
          <Input id="retencion-monto" type="number" min="0" step="0.01" inputMode="decimal" value={montoTotal} onChange={(e) => { setMontoTotal(e.target.value); setAsignaciones({}); }} placeholder="0.00" />
          {resumenBs && aplicadoUsd > 0 && <p className="text-xs text-muted-foreground">Equivale a <span className="font-semibold">{formatPrice(aplicadoUsd)}</span></p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="retencion-fecha">Fecha</Label>
          <Input id="retencion-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
      </div>

      <label className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
        <Checkbox checked={enBs} onCheckedChange={(c) => { setEnBs(!!c); setAsignaciones({}); }} className="mt-0.5" aria-label="Comprobante en bolívares" />
        <span>
          <span className="font-medium">Comprobante en bolívares</span>
          <span className="block text-xs text-muted-foreground">
            {enBs
              ? "Escriba los montos tal como aparecen en el comprobante. Cada factura se convierte a dólares con la tasa con que se emitió."
              : "Los montos se escriben en dólares."}
          </span>
        </span>
      </label>

      {enBs && hayFacturasUsd && (
        <div className="space-y-2">
          <Label htmlFor="retencion-tasa">Tasa del comprobante para facturas en USD (Bs/USD)</Label>
          <Input id="retencion-tasa" type="number" min="0" step="0.01" inputMode="decimal" value={tasaUsd || ""} onChange={(e) => setTasaUsd(parseFloat(e.target.value) || 0)} />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="retencion-numero">Nº de comprobante (opcional)</Label>
        <Input id="retencion-numero" value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Nº del comprobante de retención" />
      </div>

      {permiteComprobante && (
        <div className="space-y-2">
          <Label htmlFor="retencion-archivo">Comprobante (PDF/JPG/PNG, opcional)</Label>
          <div className="flex items-center gap-2">
            <Input id="retencion-archivo" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} className="flex-1" />
            {comprobanteFile && <Upload className="h-4 w-4 text-success" />}
          </div>
        </div>
      )}

      <SelectorFacturas
        facturas={facturasSelector}
        montoDisponible={montoDisponible}
        asignaciones={asignaciones}
        onChange={setAsignaciones}
        formatPrice={enBs ? formatoBs : formatPrice}
        conTasa={enBs}
        instruccion="Marque las facturas a las que corresponde la retención y cuánto de cada una"
        etiquetaSobrante="Falta por asignar"
      />

      <div className="space-y-2">
        <Label htmlFor="retencion-notas">Notas (opcional)</Label>
        <Textarea id="retencion-notas" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
      </div>

      <Button onClick={declarar} disabled={saving} className="gap-2">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Declarar retención
      </Button>
    </div>
  );
}
