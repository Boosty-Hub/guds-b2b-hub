import { useEffect, useRef, useState } from "react";
import { ConfiguracionLayout } from "@/components/configuracion/ConfiguracionLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Upload, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase, type Empresa } from "@/lib/supabase";
import { useEmpresa } from "@/contexts/EmpresaContext";
import { EmpresaDistintivo } from "@/components/EmpresaSelector";
import { OdooBadge } from "@/components/OdooBadge";
import { PoliticasVenta } from "@/components/configuracion/PoliticasVenta";

// Campos que GUDS administra; nombre, RIF y dirección vienen de Odoo y se editan allá.
type Editables = Pick<Empresa, "nombre_corto" | "color" | "logo_url" | "telefono" | "email" | "sitio_web">;

const editablesDe = (e: Empresa): Editables => ({
  nombre_corto: e.nombre_corto,
  color: e.color,
  logo_url: e.logo_url,
  telefono: e.telefono,
  email: e.email,
  sitio_web: e.sitio_web,
});

const CampoOdoo = ({ label, valor }: { label: string; valor: string | null }) => (
  <div className="space-y-2">
    <Label className="flex items-center gap-1.5">
      {label} <OdooBadge />
    </Label>
    <Input value={valor ?? ""} readOnly disabled className="bg-muted" />
  </div>
);

const ConfigEmpresa = () => {
  const { toast } = useToast();
  const { empresaActiva, recargarEmpresas } = useEmpresa();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [seleccionada, setSeleccionada] = useState<string>("");
  const [form, setForm] = useState<Editables | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const inputLogo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from("empresas").select("*").order("orden").then(({ data }) => {
      const lista = (data as Empresa[] | null) ?? [];
      setEmpresas(lista);
      const inicial = lista.find((e) => e.id === empresaActiva?.id) ?? lista[0];
      if (inicial) {
        setSeleccionada(inicial.id);
        setForm(editablesDe(inicial));
      }
    });
  }, [empresaActiva?.id]);

  const empresa = empresas.find((e) => e.id === seleccionada) ?? null;

  const elegir = (id: string) => {
    const e = empresas.find((x) => x.id === id);
    if (!e) return;
    setSeleccionada(id);
    setForm(editablesDe(e));
  };

  const subirLogo = async (file: File) => {
    if (!empresa) return;
    if (file.size > 1024 * 1024) {
      toast({ title: "Logo muy pesado", description: "Usa una imagen de hasta 1 MB (PNG o SVG).", variant: "destructive" });
      return;
    }
    setSubiendo(true);
    const extension = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `empresas/${empresa.id}-${Date.now()}.${extension}`;
    const { error } = await supabase.storage.from("imagenes").upload(path, file, { contentType: file.type || undefined });
    setSubiendo(false);
    if (error) {
      toast({ title: "No se pudo subir el logo", description: error.message, variant: "destructive" });
      return;
    }
    const { data } = supabase.storage.from("imagenes").getPublicUrl(path);
    setForm((f) => (f ? { ...f, logo_url: data.publicUrl } : f));
  };

  const guardar = async () => {
    if (!empresa || !form) return;
    if (!form.nombre_corto?.trim()) {
      toast({ title: "Falta el nombre corto", description: "Es el nombre que aparece en el selector del header.", variant: "destructive" });
      return;
    }
    setGuardando(true);
    const cambios = {
      nombre_corto: form.nombre_corto.trim(),
      color: form.color || null,
      logo_url: form.logo_url || null,
      telefono: form.telefono?.trim() || null,
      email: form.email?.trim() || null,
      sitio_web: form.sitio_web?.trim() || null,
    };
    const { error } = await supabase.from("empresas").update(cambios).eq("id", empresa.id);
    setGuardando(false);
    if (error) {
      toast({ title: "No se pudo guardar", description: error.message, variant: "destructive" });
      return;
    }
    setEmpresas((lista) => lista.map((e) => (e.id === empresa.id ? { ...e, ...cambios } : e)));
    await recargarEmpresas();
    toast({ title: "Empresa actualizada", description: `${cambios.nombre_corto} quedó guardada.` });
  };

  return (
    <ConfiguracionLayout title="Empresas" description="Datos de GUDS SUPPLY y QUIRUTEC en la plataforma">
      <div className="space-y-6">
        <Card className="border-border">
          <CardHeader className="p-3 pb-2">
            <CardTitle className="text-sm">Datos de la empresa</CardTitle>
            <CardDescription>
              Lo marcado con <OdooBadge className="mx-0.5" /> viene de Odoo y se edita en Odoo. El resto se usa en la plataforma:
              selector del header, tienda y documentos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {empresas.length === 0 || !empresa || !form ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {empresas.length > 1 && (
                  <Tabs value={seleccionada} onValueChange={elegir}>
                    <TabsList>
                      {empresas.map((e) => (
                        <TabsTrigger key={e.id} value={e.id} className="gap-2">
                          <EmpresaDistintivo empresa={e} className="h-5 w-5" />
                          {e.nombre_corto}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="md:col-span-2">
                    <CampoOdoo label="Razón social" valor={empresa.nombre} />
                  </div>
                  <CampoOdoo label="RIF" valor={empresa.rif} />
                  <CampoOdoo label="Ciudad / Estado" valor={[empresa.ciudad, empresa.estado].filter(Boolean).join(", ")} />
                  <div className="md:col-span-2">
                    <CampoOdoo label="Dirección fiscal" valor={empresa.direccion} />
                  </div>
                </div>

                <div className="grid gap-4 border-t border-border pt-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="nombre-corto">Nombre corto *</Label>
                    <Input id="nombre-corto" value={form.nombre_corto} onChange={(e) => setForm({ ...form, nombre_corto: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="color">Color del distintivo</Label>
                    <div className="flex items-center gap-2">
                      <Input id="color" type="color" value={form.color || "#8f1a1a"} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-10 w-16 p-1" />
                      <Input value={form.color ?? ""} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="#8f1a1a" className="font-mono" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="telefono">Teléfono</Label>
                    <Input id="telefono" value={form.telefono ?? ""} onChange={(e) => setForm({ ...form, telefono: e.target.value })} placeholder="+58 212 000 0000" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="contacto@empresa.com" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="web">Sitio web</Label>
                    <Input id="web" value={form.sitio_web ?? ""} onChange={(e) => setForm({ ...form, sitio_web: e.target.value })} placeholder="https://" />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Logo</Label>
                    <div className="flex items-center gap-4">
                      <EmpresaDistintivo empresa={{ ...empresa, ...form }} className="h-14 w-14 text-base" />
                      <input
                        ref={inputLogo}
                        type="file"
                        accept="image/png,image/svg+xml,image/webp,image/jpeg"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) subirLogo(file);
                          e.target.value = "";
                        }}
                      />
                      <Button variant="outline" size="sm" className="gap-2" disabled={subiendo} onClick={() => inputLogo.current?.click()}>
                        {subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        Subir logo
                      </Button>
                      {form.logo_url && (
                        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => setForm({ ...form, logo_url: null })}>
                          <X className="h-4 w-4" /> Quitar
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">PNG o SVG con fondo transparente, hasta 1 MB. Sin logo se muestran las iniciales sobre el color.</p>
                  </div>
                </div>

                <Button onClick={guardar} disabled={guardando} className="gap-2">
                  {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                  Guardar cambios
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <PoliticasVenta />
      </div>
    </ConfiguracionLayout>
  );
};

export default ConfigEmpresa;
