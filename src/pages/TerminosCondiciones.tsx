import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const TerminosCondiciones = () => {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Link to="/">
          <Button variant="ghost" className="mb-6">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Volver al inicio
          </Button>
        </Link>

        <h1 className="text-3xl font-bold text-foreground mb-8">
          Términos y Condiciones
        </h1>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              1. Aceptación de los Términos
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Al acceder y utilizar la plataforma GUDS, usted acepta estar sujeto a estos términos y condiciones de uso. Si no está de acuerdo con alguna parte de estos términos, no podrá acceder al servicio.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              2. Descripción del Servicio
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              GUDS es una plataforma B2B de gestión para distribución de alimentos que permite a empresas realizar pedidos, gestionar inventarios, administrar clientes y procesar pagos de manera eficiente.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              3. Registro y Cuenta de Usuario
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Para utilizar nuestros servicios, debe registrarse proporcionando información precisa y completa. Usted es responsable de mantener la confidencialidad de su cuenta y contraseña, así como de todas las actividades que ocurran bajo su cuenta.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              4. Uso Aceptable
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Usted se compromete a utilizar la plataforma únicamente para fines legales y de acuerdo con estos términos. Está prohibido:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li>Usar el servicio para actividades ilegales o fraudulentas</li>
              <li>Intentar acceder a áreas restringidas del sistema</li>
              <li>Interferir con el funcionamiento normal de la plataforma</li>
              <li>Compartir credenciales de acceso con terceros no autorizados</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              5. Pedidos y Pagos
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Los pedidos realizados a través de la plataforma están sujetos a disponibilidad de inventario. Los precios mostrados pueden variar según la lista de precios asignada a cada cliente. Los términos de pago se establecerán según el acuerdo comercial con cada empresa.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              6. Privacidad y Protección de Datos
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              La información proporcionada será tratada de acuerdo con nuestra política de privacidad. Nos comprometemos a proteger sus datos personales y comerciales utilizando medidas de seguridad apropiadas.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              7. Propiedad Intelectual
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Todo el contenido de la plataforma, incluyendo logos, diseños, textos y software, es propiedad de GUDS y está protegido por las leyes de propiedad intelectual aplicables.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              8. Limitación de Responsabilidad
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              GUDS no será responsable por daños indirectos, incidentales o consecuentes que resulten del uso o la imposibilidad de uso de la plataforma. Nuestra responsabilidad se limitará al máximo permitido por la ley aplicable.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              9. Modificaciones
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Nos reservamos el derecho de modificar estos términos en cualquier momento. Los cambios entrarán en vigor inmediatamente después de su publicación en la plataforma. El uso continuado del servicio constituye la aceptación de los términos modificados.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              10. Contacto
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Para cualquier consulta relacionada con estos términos y condiciones, puede contactarnos a través de los canales oficiales de GUDS.
            </p>
          </section>

          <div className="pt-6 border-t border-border mt-8">
            <p className="text-sm text-muted-foreground">
              Última actualización: Diciembre 2024
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TerminosCondiciones;
