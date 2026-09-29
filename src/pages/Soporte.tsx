import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Mail, Phone, MessageCircle, MapPin } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useContactoEmpresa, hrefTelefono } from "@/hooks/useContactoEmpresa";

const Soporte = () => {
  const navigate = useNavigate();
  const contacto = useContactoEmpresa();

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
            Estamos aquí para ayudarte. Estos son nuestros canales de contacto.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {contacto.email && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Mail className="h-6 w-6 text-primary" />
                  Correo electrónico
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-2">Escríbenos y te respondemos lo antes posible.</p>
                <span className="text-primary font-medium break-all select-all">{contacto.email}</span>
              </CardContent>
            </Card>
          )}
          {contacto.telefono && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  <Phone className="h-6 w-6 text-primary" />
                  Teléfono
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-2">Llámanos en horario de oficina.</p>
                <a href={hrefTelefono(contacto.telefono)} className="text-primary font-medium hover:underline">{contacto.telefono}</a>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <MessageCircle className="h-6 w-6 text-primary" />
                Desde tu cuenta
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">
                Si ya eres cliente, entra a tu cuenta: en Ayuda está tu ejecutivo de cuenta y los canales de soporte. Si aún no
                tienes cuenta, solicítala y te contactamos.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => navigate("/login")}>Iniciar sesión</Button>
                <Button size="sm" variant="outline" onClick={() => navigate("/registro")}>Solicitar una cuenta</Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-3">
                <MapPin className="h-6 w-6 text-primary" />
                Ubicación
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                {contacto.ciudad ? `${contacto.ciudad}, Venezuela` : "Venezuela"}<br />
                Zona horaria: GMT-4 (hora de Venezuela)
              </p>
            </CardContent>
          </Card>
        </div>

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
                Transferencia, pago móvil, Zelle, efectivo y crédito según las condiciones acordadas con cada cliente. Las cuentas para pagar están en tu portal, en Finanzas.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-2">
                ¿Cuánto tiempo tarda la entrega?
              </h3>
              <p className="text-muted-foreground">
                Depende de tu zona: coordinamos la entrega cuando se aprueba el pedido y te avisamos en cada paso.
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
          <p>{contacto.nombre ?? "GUDS"}</p>
          <p>© {new Date().getFullYear()} Todos los derechos reservados</p>
        </div>
      </div>
    </div>
  );
};

export default Soporte;
