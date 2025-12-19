import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";

const PoliticasPrivacidad = () => {
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

        <div className="flex items-center gap-3 mb-8">
          <Shield className="h-10 w-10 text-primary" />
          <h1 className="text-4xl font-bold text-foreground">Políticas de Privacidad</h1>
        </div>

        <div className="prose prose-gray dark:prose-invert max-w-none">
          <p className="text-muted-foreground text-lg mb-8">
            Última actualización: {new Date().toLocaleDateString('es-VE', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">1. Introducción</h2>
            <p className="text-muted-foreground leading-relaxed">
              En GUDS ("nosotros", "nuestro" o "la aplicación"), nos comprometemos a proteger la privacidad 
              y seguridad de la información personal de nuestros usuarios. Esta Política de Privacidad describe 
              cómo recopilamos, usamos, almacenamos y protegemos su información cuando utiliza nuestra aplicación 
              y servicios.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">2. Información que Recopilamos</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Podemos recopilar los siguientes tipos de información:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
              <li><strong>Información de identificación personal:</strong> Nombre, apellido, correo electrónico, número de teléfono.</li>
              <li><strong>Información del negocio:</strong> Nombre del negocio, RIF, dirección comercial, tipo de negocio.</li>
              <li><strong>Información de transacciones:</strong> Historial de pedidos, métodos de pago utilizados, preferencias de compra.</li>
              <li><strong>Información de ubicación:</strong> Dirección de entrega, coordenadas geográficas para optimizar rutas de delivery.</li>
              <li><strong>Información del dispositivo:</strong> Tipo de dispositivo, sistema operativo, identificadores únicos.</li>
              <li><strong>Información de uso:</strong> Páginas visitadas, funciones utilizadas, tiempo de sesión.</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">3. Uso de la Información</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Utilizamos la información recopilada para:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
              <li>Procesar y gestionar sus pedidos</li>
              <li>Proporcionar servicios de entrega</li>
              <li>Comunicarnos con usted sobre su cuenta y pedidos</li>
              <li>Enviar notificaciones relacionadas con el servicio</li>
              <li>Mejorar nuestros productos y servicios</li>
              <li>Personalizar su experiencia de usuario</li>
              <li>Cumplir con obligaciones legales y regulatorias</li>
              <li>Prevenir fraudes y actividades no autorizadas</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">4. Compartición de Información</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              No vendemos ni alquilamos su información personal a terceros. Podemos compartir información con:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
              <li><strong>Proveedores de servicios:</strong> Empresas que nos ayudan a operar nuestro negocio (procesamiento de pagos, servicios de hosting).</li>
              <li><strong>Personal de delivery:</strong> Información necesaria para completar las entregas (dirección, nombre del destinatario).</li>
              <li><strong>Autoridades legales:</strong> Cuando sea requerido por ley o para proteger nuestros derechos.</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">5. Seguridad de los Datos</h2>
            <p className="text-muted-foreground leading-relaxed">
              Implementamos medidas de seguridad técnicas y organizativas apropiadas para proteger su información 
              personal contra acceso no autorizado, alteración, divulgación o destrucción. Esto incluye el uso de 
              cifrado SSL/TLS, almacenamiento seguro de contraseñas y acceso restringido a datos personales.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">6. Retención de Datos</h2>
            <p className="text-muted-foreground leading-relaxed">
              Conservamos su información personal mientras sea necesario para proporcionar nuestros servicios, 
              cumplir con obligaciones legales, resolver disputas y hacer cumplir nuestros acuerdos. El período 
              de retención específico depende del tipo de información y los requisitos legales aplicables.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">7. Sus Derechos</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              Usted tiene derecho a:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
              <li>Acceder a su información personal</li>
              <li>Rectificar datos incorrectos o incompletos</li>
              <li>Solicitar la eliminación de sus datos</li>
              <li>Oponerse al procesamiento de sus datos</li>
              <li>Solicitar la portabilidad de sus datos</li>
              <li>Retirar su consentimiento en cualquier momento</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-4">
              Para ejercer estos derechos, contáctenos a través de soporte@guds.app.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">8. Cookies y Tecnologías Similares</h2>
            <p className="text-muted-foreground leading-relaxed">
              Utilizamos cookies y tecnologías similares para mejorar su experiencia, analizar el uso de la 
              aplicación y personalizar el contenido. Puede gestionar sus preferencias de cookies a través de 
              la configuración de su navegador.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">9. Menores de Edad</h2>
            <p className="text-muted-foreground leading-relaxed">
              Nuestros servicios están dirigidos a empresas y no están diseñados para menores de 18 años. 
              No recopilamos intencionalmente información de menores de edad.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">10. Cambios a esta Política</h2>
            <p className="text-muted-foreground leading-relaxed">
              Podemos actualizar esta Política de Privacidad periódicamente. Le notificaremos sobre cambios 
              significativos publicando la nueva política en nuestra aplicación y, cuando sea apropiado, 
              enviándole una notificación.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-bold text-foreground mb-4">11. Contacto</h2>
            <p className="text-muted-foreground leading-relaxed">
              Si tiene preguntas o inquietudes sobre esta Política de Privacidad o nuestras prácticas de 
              privacidad, contáctenos:
            </p>
            <div className="mt-4 text-muted-foreground">
              <p><strong>Email:</strong> soporte@guds.app</p>
              <p><strong>Teléfono:</strong> +58 412 123 4567</p>
              <p><strong>Dirección:</strong> Caracas, Venezuela</p>
            </div>
          </section>
        </div>

        <div className="text-center mt-12 text-muted-foreground text-sm border-t border-border pt-8">
          <p>GUDS - Sistema de Gestión B2B</p>
          <p>© {new Date().getFullYear()} Todos los derechos reservados</p>
        </div>
      </div>
    </div>
  );
};

export default PoliticasPrivacidad;
