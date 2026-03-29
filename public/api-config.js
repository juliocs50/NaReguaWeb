/**
 * Deixe vazio (padrão) para usar **/api** no mesmo domínio do Netlify.
 * O netlify.toml faz proxy para a Cloud Function → o browser não faz pedido cross-origin → **sem erro CORS** (“Failed to fetch”).
 *
 * Só preencha com URL direta da Function se precisares e souberes que a função aceita o teu domínio em CORS.
 */
window.NA_REGUA_API_BASE = window.NA_REGUA_API_BASE || "";
