# Barb x Go (web) — agendamento para clientes

Site estático em `public/` com cliente REST em `public/api.js` (API no Render ou outro backend que expuser os mesmos endpoints).

## Ficheiros

- `public/schedule-engine.js` — geração de slots (alinhada ao `ScheduleEngine` do app).
- `public/api.js` — cliente REST; base URL por defeito aponta para o backend; podes sobrepor com `window.NAREGUA_API_BASE_URL` antes de carregar o script (ou ajustar o defeito no ficheiro em desenvolvimento).
- `public/app-rest.js` — UI: landing, agendamento por slug, painel do dono.

## Config local (não versionada)

Se fores usar Google Maps no browser, cria `public/firebase-config.js` a partir de
`public/firebase-config.example.js` e **não commites** chaves reais.

## URLs públicas (slug)

O agendamento do cliente usa o **primeiro segmento do path** como slug da barbearia (ex.: `https://www.barbxgo.app/minha-loja`). O frontend chama o REST (`publicShopBySlug`, etc.). Rotas reservadas no cliente incluem `about` e `public`.

## Hospedagem

- **Vercel (fluxo actual):** na raiz está `vercel.json` — `outputDirectory` = `public/` e **rewrites** para servir `index.html` nas rotas dinâmicas (`/:slug`), necessário para o SPA funcionar ao refrescar ou partilhar link.
- **Domínio:** na raiz existe `CNAME` (`www.barbxgo.app`), útil em fluxos tipo **GitHub Pages**; na Vercel o domínio customizado confirma-se no painel do projeto (o ficheiro pode coexistir com o deploy na Vercel).
- **Netlify:** existe `netlify.toml` com redirect SPA (`/*` → `index.html`); só é relevante se o site estiver ligado ao Netlify. Se não usas Netlify, podes ignorar ou remover esse ficheiro noutro PR.

Não é necessário proxy `/api` no hosting: a API é outro origin (CORS tratado no backend).
