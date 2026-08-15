import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Building2,
  User,
  Mail,
  MapPin,
  FileText,
  CheckCircle,
  ArrowLeft,
  Loader2,
  Upload,
  Paperclip,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/Logo";
import { RifInput, isValidRif } from "@/components/forms/RifInput";
import { PhoneInput, isValidPhone } from "@/components/forms/PhoneInput";
import { supabase } from "@/lib/supabase";
import { compressImage } from "@/lib/image";

const MAX_DOC_SIZE = 5 * 1024 * 1024; // debe coincidir con el file_size_limit del bucket `documentos`
const ALLOWED_DOC_TYPES = ["application/pdf", "image/jpeg", "image/png"];

const tiposNegocio = [
  "Kiosco",
  "Abasto",
  "Supermercado",
  "Bodega",
  "Licorería",
  "Restaurante",
  "Hotel",
  "Panadería",
  "Cafetería",
  "Distribuidor(a)",
  "Bodegón",
  "Mini farmacia",
  "Cantina",
  "Otro",
];

const step1Schema = z.object({
  nombreNegocio: z.string().trim().min(1, "La razón social es requerida"),
  tipoNegocio: z.string().min(1, "Selecciona el tipo de negocio"),
  rif: z.string().refine(isValidRif, "RIF incompleto — formato J-12345678-9"),
  contribuyenteEspecial: z.boolean(),
});

const step2Schema = z.object({
  nombreContacto: z.string().trim().min(1, "La persona de contacto es requerida"),
  email: z.string().trim().email("Ingresa un email válido"),
  telefono: z.string().refine(isValidPhone, "Teléfono incompleto"),
});

const step3Schema = z.object({
  direccion: z.string().trim().min(1, "La dirección fiscal es requerida"),
  mismaDireccionEntrega: z.boolean(),
  direccionEntrega: z.string().trim().optional(),
  ciudad: z.string().trim().min(1, "La ciudad es requerida"),
}).refine(
  (data) => data.mismaDireccionEntrega || !!data.direccionEntrega,
  { message: "Ingresa la dirección de entrega", path: ["direccionEntrega"] },
);

const fullSchema = step1Schema.merge(step2Schema).and(step3Schema);
type FormValues = z.infer<typeof fullSchema>;

const Registro = () => {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [rifDocumento, setRifDocumento] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addRegistro } = useAuth();
  const { toast } = useToast();

  const form = useForm<FormValues>({
    resolver: zodResolver(fullSchema),
    mode: "onChange",
    defaultValues: {
      nombreNegocio: "",
      tipoNegocio: "",
      rif: "",
      contribuyenteEspecial: false,
      nombreContacto: "",
      email: "",
      telefono: "",
      direccion: "",
      mismaDireccionEntrega: true,
      direccionEntrega: "",
      ciudad: "",
    },
  });

  const values = form.watch();

  const goNext = async () => {
    const schema = step === 1 ? step1Schema : step2Schema;
    const fields = Object.keys(schema.shape) as (keyof FormValues)[];
    const ok = await form.trigger(fields);
    if (!ok) return;
    if (step === 1 && !rifDocumento) {
      toast({
        title: "Falta el documento del RIF",
        description: "Adjunta el RIF en PDF o foto para continuar",
        variant: "destructive",
      });
      return;
    }
    setStep(step + 1);
  };

  const handleDocumentSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_DOC_TYPES.includes(file.type)) {
      toast({ title: "Formato no permitido", description: "Solo se aceptan PDF, JPG o PNG", variant: "destructive" });
      return;
    }
    if (file.size > MAX_DOC_SIZE) {
      toast({ title: "Archivo muy grande", description: "El máximo es 5 MB", variant: "destructive" });
      return;
    }
    setRifDocumento(file);
  };

  const uploadRifDocumento = async (file: File): Promise<string> => {
    const isImage = file.type.startsWith("image/");
    const body = isImage ? await compressImage(file, 1600, 0.85) : file;
    const ext = isImage ? "jpg" : "pdf";
    const path = `registros/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from("documentos").upload(path, body, {
      contentType: isImage ? "image/jpeg" : "application/pdf",
    });
    if (error) throw error;
    return path;
  };

  const handleSubmit = async (data: FormValues) => {
    if (!rifDocumento) {
      toast({
        title: "Falta el documento del RIF",
        description: "Vuelve al paso 1 y adjunta el RIF",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const rifDocumentoPath = await uploadRifDocumento(rifDocumento);
      const ok = await addRegistro({
        nombreNegocio: data.nombreNegocio,
        tipoNegocio: data.tipoNegocio,
        rif: data.rif,
        contribuyenteEspecial: data.contribuyenteEspecial,
        rifDocumentoPath,
        nombreContacto: data.nombreContacto,
        apellidoContacto: "",
        email: data.email,
        telefono: data.telefono,
        direccion: data.direccion,
        direccionEntrega: data.mismaDireccionEntrega ? null : (data.direccionEntrega || null),
        ciudad: data.ciudad,
      });

      if (!ok) {
        toast({
          title: "No se pudo enviar la solicitud",
          description: "Revisa tu conexión e inténtalo de nuevo. Si el problema persiste, contáctanos.",
          variant: "destructive",
        });
        return;
      }
      setIsSuccess(true);
    } catch {
      toast({
        title: "No se pudo subir el documento",
        description: "Revisa tu conexión e inténtalo de nuevo.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="h-20 w-20 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="h-10 w-10 text-green-500" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-3">
            ¡Solicitud Enviada!
          </h1>
          <p className="text-muted-foreground mb-6">
            Hemos recibido tu solicitud de registro. Nuestro equipo la revisará y te contactaremos
            en las próximas 24-48 horas hábiles.
          </p>
          <div className="bg-muted rounded-xl p-4 mb-6 text-left">
            <p className="text-sm text-muted-foreground mb-2">Datos de tu solicitud:</p>
            <p className="font-medium">{values.nombreNegocio}</p>
            <p className="text-sm text-muted-foreground">{values.email}</p>
          </div>
          <div className="space-y-3">
            <Link to="/">
              <Button className="w-full">Volver al Inicio</Button>
            </Link>
            <Link to="/login">
              <Button variant="outline" className="w-full">
                Ya tengo cuenta - Iniciar Sesión
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <ArrowLeft className="h-5 w-5" />
            <Logo className="h-8 text-primary" />
          </Link>
          <Link to="/login" className="text-sm text-primary font-medium">
            ¿Ya tienes cuenta? Inicia Sesión
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-xl mx-auto">
          <div className="mb-8">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Paso {step} de 3</span>
              <span className="text-sm text-muted-foreground">
                {step === 1 && "Datos del Negocio"}
                {step === 2 && "Datos de Contacto"}
                {step === 3 && "Dirección"}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${(step / 3) * 100}%` }}
              />
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border p-6 md:p-8">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              Registro de Cliente
            </h1>
            <p className="text-muted-foreground mb-6">
              Completa el formulario para solicitar tu cuenta de cliente
            </p>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)}>
                {step === 1 && (
                  <div className="space-y-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                      <Building2 className="h-6 w-6 text-primary" />
                    </div>

                    <FormField
                      control={form.control}
                      name="nombreNegocio"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Razón Social *</FormLabel>
                          <FormControl>
                            <Input placeholder="Ej: Bodega El Sol, C.A." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="tipoNegocio"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tipo de Negocio *</FormLabel>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Selecciona el tipo" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {tiposNegocio.map((tipo) => (
                                <SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="rif"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>RIF *</FormLabel>
                          <FormControl>
                            <RifInput value={field.value} onChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="contribuyenteEspecial"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="!mt-0 cursor-pointer">
                            Soy contribuyente especial
                          </FormLabel>
                        </FormItem>
                      )}
                    />

                    <div className="space-y-2">
                      <label className="text-sm font-medium leading-none">Documento del RIF *</label>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="application/pdf,image/jpeg,image/png"
                        className="hidden"
                        onChange={handleDocumentSelect}
                      />
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full border-2 border-dashed border-border rounded-xl p-4 text-center hover:border-primary transition-colors"
                      >
                        {rifDocumento ? (
                          <span className="flex items-center justify-center gap-2 text-sm">
                            <Paperclip className="h-4 w-4 text-primary" />
                            {rifDocumento.name}
                          </span>
                        ) : (
                          <span className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
                            <Upload className="h-6 w-6" />
                            Toca para adjuntar el RIF (PDF, JPG o PNG, máx. 5 MB)
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                      <User className="h-6 w-6 text-primary" />
                    </div>

                    <FormField
                      control={form.control}
                      name="nombreContacto"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Persona de Contacto *</FormLabel>
                          <FormControl>
                            <Input placeholder="Juan Pérez" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email *</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                              <Input type="email" placeholder="correo@ejemplo.com" className="pl-10" {...field} />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="telefono"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Teléfono *</FormLabel>
                          <FormControl>
                            <PhoneInput value={field.value} onChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-4">
                    <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                      <MapPin className="h-6 w-6 text-primary" />
                    </div>

                    <FormField
                      control={form.control}
                      name="direccion"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Dirección Fiscal *</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Av. Principal, Edificio Centro, Local 5" rows={3} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="mismaDireccionEntrega"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2 space-y-0">
                          <FormControl>
                            <Checkbox
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <FormLabel className="!mt-0 cursor-pointer">
                            La dirección de entrega es la misma que la fiscal
                          </FormLabel>
                        </FormItem>
                      )}
                    />

                    {!values.mismaDireccionEntrega && (
                      <FormField
                        control={form.control}
                        name="direccionEntrega"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Dirección de Entrega *</FormLabel>
                            <FormControl>
                              <Textarea placeholder="Dirección donde recibirás los pedidos" rows={3} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    <FormField
                      control={form.control}
                      name="ciudad"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Ciudad *</FormLabel>
                          <FormControl>
                            <Input placeholder="Caracas" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="bg-muted rounded-xl p-4 mt-6">
                      <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Resumen de tu Solicitud
                      </h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Razón Social:</span>
                          <span className="font-medium">{values.nombreNegocio}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Tipo:</span>
                          <span>{values.tipoNegocio}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">RIF:</span>
                          <span>{values.rif}{values.contribuyenteEspecial ? " · Contribuyente especial" : ""}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Contacto:</span>
                          <span>{values.nombreContacto}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Email:</span>
                          <span>{values.email}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Documento RIF:</span>
                          <span>{rifDocumento ? rifDocumento.name : "—"}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-3 mt-8">
                  {step > 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setStep(step - 1)}
                      className="flex-1"
                    >
                      Anterior
                    </Button>
                  )}

                  {step < 3 ? (
                    <Button type="button" onClick={goNext} className="flex-1">
                      Siguiente
                    </Button>
                  ) : (
                    <Button type="submit" className="flex-1" disabled={isSubmitting}>
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Enviando...
                        </>
                      ) : (
                        "Enviar Solicitud"
                      )}
                    </Button>
                  )}
                </div>
              </form>
            </Form>
          </div>

          <p className="text-center text-sm text-muted-foreground mt-6">
            ¿Necesitas ayuda? Contáctanos al{" "}
            <a href="tel:+582125550000" className="text-primary font-medium">
              +58 212-555-0000
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Registro;
