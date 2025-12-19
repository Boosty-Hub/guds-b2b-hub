import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Mail, Phone, MessageCircle, Clock, MapPin } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Soporte = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Button
          variant="ghost"
          onClick={() => navigate(-1)}
          className="mb-6"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>

        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-foreground mb-4">Centro de Soporte</h1>
          <p className="text-muted-foreground text-lg">
            Estamos aquí para ayudarte. Contáctanos a través de cualquiera de nuestros canales.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Mail className="h-6 w-6 text-primary" />
                Correo Electrónico
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-2">
                Envíanos un correo y te responderemos en menos de 24 horas.
              </p>
              <a 
                href="mailto:soporte@guds.app" 
                className="text-primary font-medium hover:underline"
              >
                soporte@guds.app
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Phone className="h-6 w-6 text-primary" />
                Teléfono
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-2">
                Llámanos de lunes a viernes en horario de oficina.
              </p>
              <a 
                href="tel:+584121234567" 
                className="text-primary font-medium hover:underline"
              >
                +58 412 123 4567
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <MessageCircle className="h-6 w-6 text-primary" />
                WhatsApp
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-2">
                Escríbenos por WhatsApp para una respuesta rápida.
              </p>
              <a 
                href="https://wa.me/584121234567" 
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary font-medium hover:underline"
              >
                Iniciar chat
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <Clock className="h-6 w-6 text-primary" />
                Horario de Atención
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                Lunes a Viernes: 8:00 AM - 6:00 PM<br />
                Sábados: 9:00 AM - 1:00 PM<br />
                Domingos: Cerrado
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-12">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <MapPin className="h-6 w-6 text-primary" />
              Ubicación
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Caracas, Venezuela<br />
              Zona horaria: GMT-4 (Hora de Venezuela)
            </p>
          </CardContent>
        </Card>

        <div className="bg-muted rounded-lg p-8 text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Preguntas Frecuentes
          </h2>
          <div className="text-left max-w-2xl mx-auto space-y-6">
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                ¿Cómo puedo realizar un pedido?
              </h3>
              <p className="text-muted-foreground">
                Inicia sesión en tu cuenta, navega por el catálogo de productos, agrega los items a tu carrito y procede al checkout.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                ¿Cuáles son los métodos de pago aceptados?
              </h3>
              <p className="text-muted-foreground">
                Aceptamos transferencias bancarias, pago móvil, efectivo y crédito según las condiciones acordadas con cada cliente.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                ¿Cuánto tiempo tarda la entrega?
              </h3>
              <p className="text-muted-foreground">
                El tiempo de entrega depende de tu ubicación. Generalmente las entregas se realizan en 24-48 horas hábiles.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                ¿Cómo puedo hacer seguimiento de mi pedido?
              </h3>
              <p className="text-muted-foreground">
                Desde tu portal de cliente puedes ver el estado de todos tus pedidos en tiempo real.
              </p>
            </div>
          </div>
        </div>

        <div className="text-center mt-12 text-muted-foreground text-sm">
          <p>GUDS - Sistema de Gestión B2B</p>
          <p>© {new Date().getFullYear()} Todos los derechos reservados</p>
        </div>
      </div>
    </div>
  );
};

export default Soporte;
