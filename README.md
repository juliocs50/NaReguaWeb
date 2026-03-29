# NaReguaWeb — agendamento para clientes

Site estático que fala **direto com o Firestore** (SDK Web), como o app Android: **mesmo projeto** `naregua-61564`, mesmas coleções `barbershops/{id}/barbers`, `services`, `appointments`.

**Não é obrigatório usar Cloud Functions** para marcar horário neste site.

## Firebase Console (uma vez)

1. **Authentication** → **Sign-in method** → ativar **Anonymous** (anónimo).  
   As regras atuais exigem `request.auth != null`; o site faz `signInAnonymously()`.

2. **Firestore** → regras: o site usa utilizador **anónimo** (`request.auth != null`). A **página inicial** lista barbearias com `collection("barbershops").get()` — é preciso permitir **leitura em lista** da coleção `barbershops` (não só `get` num documento), por exemplo: `allow read: if request.auth != null` em `match /barbershops/{shopId}` (isso cobre queries na coleção).

## Ficheiros

- `public/firebase-config.js` — `apiKey` / `projectId` alinhados ao Android (`google-services.json`).
- `public/schedule-engine.js` — geração de slots (igual ao `ScheduleEngine` do app).
- `public/app.js` — leituras Firestore + transação ao confirmar marcação.

## URL por barbearia

`/jabarber` resolve contra `barbershops`: campos opcionais `slug` ou `nameLowercase` (como no backend anterior).

## Netlify

Só precisas de **redirect SPA** (`/*` → `index.html`). O proxy `/api` **já não é necessário** para o agendamento.

Deploy: pasta `public/` como site estático.
