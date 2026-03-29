# NaReguaWeb — agendamento para clientes

Site estático focado em **marcar horário** (nome + telefone), alinhado visualmente ao app **Na Régua** (Material / roxo).

O site usa o **mesmo projeto Firebase** que o Android (`project_id`: **naregua-61564**, ver `app/google-services.json`). As Cloud Functions são as do repositório NaRegua (`functions/`), deploy com `firebase deploy --only functions`.

## URL amigável por barbearia

Use o **primeiro segmento do caminho** como identificador:

`https://SEU_SITE.netlify.app/ja-barber`

O backend resolve o slug assim (Firestore, coleção `barbershops`):

1. Campo opcional **`slug`** (ex.: `ja-barber`) — recomendado para URL curta e estável.
2. Campo **`nameLowercase`** (igual ao app): comparação exata ou com hífens trocados por espaço  
   (ex.: URL `ja-barber` ↔ `nameLowercase` `ja barber`).

Exemplo: nome da barbearia **JaBarber** → `nameLowercase` costuma ser **`jabarber`** → link:  
`https://…/jabarber`

Se quiser um texto com espaços no Firestore, use hífen na URL:  
`ja barber` → `…/ja-barber`

## API (Cloud Function `naReguaWebApi`)

Após deploy das Functions no Firebase, configure:

- **Netlify:** edite `netlify.toml` e substitua `SEU_PROJECT_ID` pela URL real da função.
- Ou **Firebase Hosting:** use o `firebase.json` desta pasta (rewrites `/api` + SPA).

Variável opcional no HTML (só se não usar proxy `/api`):

```html
<script>
  window.NA_REGUA_API_BASE = "https://southamerica-east1-XXX.cloudfunctions.net/naReguaWebApi";
</script>
```

## Deploy

1. `firebase deploy --only functions` (no repositório do app Android, pasta `functions`) para publicar `naReguaWebApi` com `resolveShop`.
2. Ajustar `netlify.toml` com a URL da função.
3. Push no Netlify (ou `firebase deploy --only hosting` se usar Firebase Hosting).

## Erro 404 / HTML na página

Se aparecer mensagem sobre **API não encontrada (404)** ou texto estranho, o proxy `/api` do Netlify não está a bater na Cloud Function. Corrija **uma** destas opções:

- Em `netlify.toml`, substitua `SEU_PROJECT_ID` pela URL completa copiada no Firebase (Functions → `naReguaWebApi` → URL).
- Ou edite `public/api-config.js` e defina `window.NA_REGUA_API_BASE = "https://…/naReguaWebApi";` (URL direta, sem depender do proxy).
