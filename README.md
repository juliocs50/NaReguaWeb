# NaReguaWeb (Agendamento)

Projeto web estático (HTML/JS) para o cliente ver horários e agendar.

## Como usar
1. Garanta que as Cloud Functions já foram deployadas no Firebase:
   - `naReguaWebApi`
2. Configure/ateive Firebase Hosting para esta pasta.
3. Depois de fazer `firebase deploy`, o site fica acessível.

## URL
Abra algo como:
`https://SEU_SITE/?shopId=ID_DA_BARBEARIA`

Se não passar `shopId`, a página pede manualmente.

## Campos do agendamento
O cliente informa somente:
- Nome
- Telefone

E seleciona:
- Barbeiro
- Serviço
- Horário livre

