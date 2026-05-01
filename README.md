# Barb x Go (web) — agendamento para clientes

Site estático com frontend em `public/` e cliente REST em `public/api.js` (backend fora do site).

## Ficheiros

- `public/schedule-engine.js` — geração de slots (igual ao `ScheduleEngine` do app).
- `public/api.js` — cliente REST (base configurável por `window.NAREGUA_API_BASE_URL`).
- `public/app-rest.js` — UI e fluxo de agendamento/owner via REST.

## Config local (não versionada)

Se você for usar Google Maps no browser, crie `public/firebase-config.js` a partir de
`public/firebase-config.example.js` e **não commite** chaves reais.

## URL por barbearia

`/jabarber` resolve contra `barbershops`: campos opcionais `slug` ou `nameLowercase` (como no backend anterior).

## Netlify

Só precisas de **redirect SPA** (`/*` → `index.html`). O proxy `/api` **já não é necessário** para o agendamento.

Deploy: pasta `public/` como site estático.
