import type { CapacitorConfig } from "@capacitor/cli";

// Shell nativo de "Guds Store" (iOS). Carga el portal en vivo desde server.url;
// el build de dist/ solo se empaqueta como respaldo.
// Se apunta a /login (no a "/") porque "/" es la landing de marketing y el shell
// nunca debe mostrarla (App Store Review Guideline 4.2).
const config: CapacitorConfig = {
  appId: "com.guds.guds",
  appName: "Guds Store",
  webDir: "dist",
  server: {
    url: "https://portal.guds-supply.com/login",
    cleartext: false,
    // Pantalla local (va en el binario: public/offline.html → dist/) cuando no se puede cargar el portal.
    // Capacitor la resuelve contra el origen local de la app (webDir), no contra server.url.
    errorPath: "offline.html",
  },
  appendUserAgent: "GudsStoreNativa",
  ios: {
    contentInset: "always",
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
