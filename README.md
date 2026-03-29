# NaReguaWeb — agendamento para clientes

Site estático que fala **direto com o Firestore** (SDK Web), como o app Android: **mesmo projeto** `naregua-61564`, mesmas coleções `barbershops/{id}/barbers`, `services`, `appointments`.

**Não é obrigatório usar Cloud Functions** para marcar horário neste site.

## Firebase Console (uma vez)

1. **Authentication** → **Sign-in method** → ativar **Anonymous** (anónimo).  
   As regras atuais exigem `request.auth != null`; o site faz `signInAnonymously()`.

2. (Opcional) **Firestore** → regras: as tuas regras já permitem leitura/escrita para qualquer utilizador autenticado (incluindo anónimo).

## Ficheiros

- `public/firebase-config.js` — `apiKey` / `projectId` alinhados ao Android (`google-services.json`).
- `public/schedule-engine.js` — geração de slots (igual ao `ScheduleEngine` do app).
- `public/app.js` — leituras Firestore + transação ao confirmar marcação.

## URL por barbearia

`/jabarber` resolve contra `barbershops`: campos opcionais `slug` ou `nameLowercase` (como no backend anterior).

## Netlify

Só precisas de **redirect SPA** (`/*` → `index.html`). O proxy `/api` **já não é necessário** para o agendamento.

Deploy: pasta `public/` como site estático.
