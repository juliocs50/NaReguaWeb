/**
 * IMPORTANTE: deixe vazio para usar **/api** no mesmo domínio (Netlify → proxy → Firebase).
 * Assim o browser NÃO chama cloudfunctions.net direto → evita "Failed to fetch" por CORS.
 *
 * Só preencha com URL completa se souber o que está a fazer (testes locais, etc.):
 * window.NA_REGUA_API_BASE = "https://southamerica-east1-naregua-61564.cloudfunctions.net/naReguaWebApi";
 */
window.NA_REGUA_API_BASE = window.NA_REGUA_API_BASE || "";
