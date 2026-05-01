/**
 * EXEMPLO (não commite chaves reais).
 *
 * Se você usar Google Maps no browser, crie um `firebase-config.js` ao lado
 * deste arquivo (NÃO versionado) e preencha a chave com restrição por domínio.
 *
 * Observação: o site atualmente usa backend REST (ver `api.js`), então este
 * arquivo é opcional e só é necessário se você reativar integração via Firebase/Maps no front.
 */
window.FIREBASE_CONFIG = window.FIREBASE_CONFIG || {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

window.GOOGLE_MAPS_API_KEY = window.GOOGLE_MAPS_API_KEY || "";

