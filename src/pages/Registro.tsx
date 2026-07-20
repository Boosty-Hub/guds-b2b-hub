import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Phone, 
  MapPin, 
  FileText,
  CheckCircle,
  ArrowLeft,
  Loader2
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Logo } from "@/components/Logo";

const tiposNegocio = [
  "Bodega",
  "Mini Market",
  "Supermercado",
  "Restaurante",
  "Hotel",
  "Panadería",
  "Cafetería",
  "Distribuidora",
  "Otro",
];

const Registro = () => {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const { addRegistro } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    nombreNegocio: "",
    tipoNegocio: "",
    rif: "",
    nombreContacto: "",
    apellidoContacto: "",
    email: "",
    telefono: "",
    direccion: "",
    ciudad: "",
  });

  const handleChange = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value });
  };

  const validateStep1 = () => {
    if (!formData.nombreNegocio || !formData.tipoNegocio || !formData.rif) {
      toast({
        title: "Campos requeridos",
        description: "Por favor completa todos los campos del negocio",
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const validateStep2 = () => {
    if (!formData.nombreContacto || !formData.apellidoContacto || !formData.email || !formData.telefono) {
      toast({
        title: "Campos requeridos",
        description: "Por favor completa todos los campos de contacto",
        variant: "destructive",
      });
      return false;
    }
    if (!formData.email.includes("@")) {
      toast({
        title: "Email inválido",
        description: "Por favor ingresa un email válido",
        variant: "destructive",
      });
      return false;
    }
    return true;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) {
      setStep(2);
    } else if (step === 2 && validateStep2()) {
      setStep(3);
    }
  };

  const handleSubmit = async () => {
    if (!formData.direccion || !formData.ciudad) {
      toast({
        title: "Campos requeridos",
        description: "Por favor completa la dirección",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    // Persistir la solicitud de verdad y solo mostrar éxito si se guardó.
    const ok = await addRegistro(formData);
    setIsSubmitting(false);

    if (!ok) {
      toast({
        title: "No se pudo enviar la solicitud",
        description: "Revisa tu conexión e inténtalo de nuevo. Si el problema persiste, contáctanos.",
        variant: "destructive",
      });
      return;
    }
    setIsSuccess(true);
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
            <p className="font-medium">{formData.nombreNegocio}</p>
            <p className="text-sm text-muted-foreground">{formData.email}</p>
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
      {/* Header */}
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
          {/* Progress */}
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

          {/* Form */}
          <div className="bg-card rounded-2xl border border-border p-6 md:p-8">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              Registro de Cliente Mayorista
            </h1>
            <p className="text-muted-foreground mb-6">
              Completa el formulario para solicitar tu cuenta de cliente
            </p>

            {/* Step 1: Business Info */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                
                <div className="space-y-2">
                  <Label>Nombre del Negocio *</Label>
                  <Input
                    placeholder="Ej: Bodega El Sol"
                    value={formData.nombreNegocio}
                    onChange={(e) => handleChange("nombreNegocio", e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Tipo de Negocio *</Label>
                  <Select
                    value={formData.tipoNegocio}
                    onValueChange={(value) => handleChange("tipoNegocio", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona el tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {tiposNegocio.map((tipo) => (
                        <SelectItem key={tipo} value={tipo}>{tipo}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>RIF *</Label>
                  <Input
                    placeholder="J-12345678-9"
                    value={formData.rif}
                    onChange={(e) => handleChange("rif", e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Step 2: Contact Info */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <User className="h-6 w-6 text-primary" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Nombre *</Label>
                    <Input
                      placeholder="Juan"
                      value={formData.nombreContacto}
                      onChange={(e) => handleChange("nombreContacto", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Apellido *</Label>
                    <Input
                      placeholder="Pérez"
                      value={formData.apellidoContacto}
                      onChange={(e) => handleChange("apellidoContacto", e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Email *</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="email"
                      placeholder="correo@ejemplo.com"
                      className="pl-10"
                      value={formData.email}
                      onChange={(e) => handleChange("email", e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Teléfono *</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="+58 412-555-1234"
                      className="pl-10"
                      value={formData.telefono}
                      onChange={(e) => handleChange("telefono", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Address */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                  <MapPin className="h-6 w-6 text-primary" />
                </div>

                <div className="space-y-2">
                  <Label>Dirección Completa *</Label>
                  <Textarea
                    placeholder="Av. Principal, Edificio Centro, Local 5"
                    value={formData.direccion}
                    onChange={(e) => handleChange("direccion", e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Ciudad *</Label>
                  <Input
                    placeholder="Caracas"
                    value={formData.ciudad}
                    onChange={(e) => handleChange("ciudad", e.target.value)}
                  />
                </div>

                {/* Summary */}
                <div className="bg-muted rounded-xl p-4 mt-6">
                  <h3 className="font-semibold mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Resumen de tu Solicitud
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Negocio:</span>
                      <span className="font-medium">{formData.nombreNegocio}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tipo:</span>
                      <span>{formData.tipoNegocio}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">RIF:</span>
                      <span>{formData.rif}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Contacto:</span>
                      <span>{formData.nombreContacto} {formData.apellidoContacto}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Email:</span>
                      <span>{formData.email}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 mt-8">
              {step > 1 && (
                <Button 
                  variant="outline" 
                  onClick={() => setStep(step - 1)}
                  className="flex-1"
                >
                  Anterior
                </Button>
              )}
              
              {step < 3 ? (
                <Button onClick={handleNext} className="flex-1">
                  Siguiente
                </Button>
              ) : (
                <Button 
                  onClick={handleSubmit} 
                  className="flex-1"
                  disabled={isSubmitting}
                >
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
          </div>

          {/* Help */}
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
