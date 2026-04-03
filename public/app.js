/**
 * Agendamento direto no Firestore (igual conceito do app Android), com Auth anónima.
 * Requer: Firebase Console → Authentication → Sign-in method → Anonymous → Enable
 * Regras: firestore.rules com request.auth != null
 */
/* global firebase */

const $ = (id) => document.getElementById(id);

const APP_FEE_CENTS = 100;

/**
 * Slot vazio depois do horário atual — não usar "Livre".
 * Alternativas boas: "Horário passado", "Indisponível", "Expirado", "Encerrado".
 */
const LABEL_FREE_SLOT_PAST = "Horário encerrado";

let db = null;

function toDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getQueryParam(name) {
  return new URL(window.location.href).searchParams.get(name);
}

function getSlugFromPath() {
  let path = window.location.pathname || "/";
  if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1);
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0];
  if (first === "index.html") return null;
  return decodeURIComponent(first);
}

function renderOptions(selectEl, items, getValue, getLabel) {
  selectEl.innerHTML = "";
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = getValue(item);
    opt.textContent = getLabel(item);
    selectEl.appendChild(opt);
  }
}

function setHomeStatus(msg, isError = false) {
  const el = $("homeStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("err", !!isError);
}

function setOwnerStatus(msg, isError = false) {
  const el = $("ownerStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("err", !!isError);
}

function setStatus(msg, isError = false) {
  const el = $("status");
  if (!el) return;
  el.textContent = msg || "";
  el.classList.toggle("err", !!isError);
}

function priceToBRL(cents) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Mesmo critério do app Android — evita dois agendamentos com o mesmo nome no dia. */
function normalizeClientName(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function showShopHeader(name) {
  const badge = $("shopBadge");
  if (!badge) return;
  badge.textContent = name;
  badge.hidden = false;
}

function hideShopHeader() {
  const badge = $("shopBadge");
  if (!badge) return;
  badge.hidden = true;
  badge.textContent = "";
}

function barberFromDoc(doc) {
  const data = doc.data();
  const scheduleByDay = window.NaReguaSchedule.parseScheduleFromFirestore(
    data.scheduleByDay
  );
  return { id: doc.id, name: data.name || "", scheduleByDay };
}

function serviceFromDoc(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    name: d.name || "",
    priceCents: Number(d.priceCents),
    durationMinutes: Number(d.durationMinutes != null ? d.durationMinutes : 30),
  };
}

let __firebaseCoreReady = false;

async function initFirebaseCore() {
  if (__firebaseCoreReady) return;
  if (!window.FIREBASE_CONFIG) {
    throw new Error("Falta firebase-config.js");
  }
  if (!firebase.apps.length) {
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }
  db = firebase.firestore();
  __firebaseCoreReady = true;
}

/** Cliente em /slug: precisa de sessão (anónima) para ler Firestore. */
async function ensureAnonymousForPublicBooking() {
  await initFirebaseCore();
  const u = firebase.auth().currentUser;
  if (u && !u.isAnonymous) return;
  if (!u) {
    try {
      await firebase.auth().signInAnonymously();
    } catch (e) {
      throw new Error(
        "Login anónimo falhou. No Firebase Console → Authentication, ative «Anónimo»."
      );
    }
  }
}

async function resolveShopSlug(slug) {
  const raw = decodeURIComponent(slug).trim().toLowerCase();
  if (!raw) return null;
  const col = db.collection("barbershops");
  const attempts = [
    ["slug", raw],
    ["nameLowercase", raw],
    ["nameLowercase", raw.replace(/-/g, " ")],
  ];
  for (let i = 0; i < attempts.length; i++) {
    const field = attempts[i][0];
    const val = attempts[i][1];
    const snap = await col.where(field, "==", val).limit(1).get();
    if (!snap.empty) {
      const doc = snap.docs[0];
      return { shopId: doc.id, name: doc.data().name || "" };
    }
  }
  return null;
}

async function loadBarbers(shopId) {
  const snap = await db
    .collection("barbershops")
    .doc(shopId)
    .collection("barbers")
    .get();
  return snap.docs.map(barberFromDoc);
}

async function loadServices(shopId) {
  const snap = await db
    .collection("barbershops")
    .doc(shopId)
    .collection("services")
    .get();
  return snap.docs.map(serviceFromDoc).filter(function (s) {
    return s.name && !isNaN(s.priceCents);
  });
}

/** Agenda pública: não incluir telefone — só o app do barbeiro exibe. */
async function appointmentsForDayDetailed(shopId, dateKey) {
  const snap = await db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments")
    .where("dateKey", "==", dateKey)
    .get();
  return snap.docs.map(function (doc) {
    const x = doc.data();
    return {
      id: doc.id,
      barberId: x.barberId || "",
      timeLabel: x.timeLabel || "",
      status: x.status || "SCHEDULED",
      clientName: x.clientName || "",
      serviceName: x.serviceName || "",
      serviceId: x.serviceId || "",
      servicePriceCents: (x.servicePriceCents != null ? Number(x.servicePriceCents) : 0),
      appFeeCents: (x.appFeeCents != null ? Number(x.appFeeCents) : 0),
      createdBy: x.createdBy || "CLIENT",
    };
  });
}

function renderDayAgenda(barber, dateKey, appointmentsForBarber) {
  const host = $("dayAgenda");
  if (!host || !window.NaReguaSchedule.buildDayAgendaList) return;
  const rows = window.NaReguaSchedule.buildDayAgendaList(
    barber.scheduleByDay,
    dateKey,
    appointmentsForBarber,
    new Date()
  );
  host.innerHTML = "";
  if (!rows.length) {
    host.innerHTML =
      '<p class="muted">Sem grade neste dia (folga ou sem horários cadastrados).</p>';
    return;
  }
  const list = document.createElement("div");
  list.className = "day-agenda-list";
  rows.forEach(function (r) {
    const row = document.createElement("div");
    row.className = "day-agenda-row";
    const time = document.createElement("span");
    time.className = "day-agenda-time";
    time.textContent = r.timeLabel;
    const body = document.createElement("div");
    body.className = "day-agenda-body";
    if (r.state === "lunch") {
      row.classList.add("is-lunch");
      const badge = document.createElement("span");
      badge.className = "agenda-badge agenda-badge-lunch";
      badge.textContent = "Almoço";
      body.appendChild(badge);
      const sub = document.createElement("span");
      sub.className = "day-agenda-lunch-sub";
      sub.textContent = r.lunchSubtitle || "Pausa — sem atendimentos neste intervalo";
      body.appendChild(sub);
    } else if (r.state === "past") {
      row.classList.add("is-past");
      const badge = document.createElement("span");
      badge.className = "agenda-badge agenda-badge-past";
      badge.textContent = LABEL_FREE_SLOT_PAST;
      body.appendChild(badge);
    } else if (r.state === "free") {
      row.classList.add("is-free");
      const badge = document.createElement("span");
      badge.className = "agenda-badge agenda-badge-free";
      badge.textContent = "Livre";
      body.appendChild(badge);
    } else if (r.state === "done") {
      row.classList.add("is-done");
      const badge = document.createElement("span");
      badge.className = "agenda-badge agenda-badge-done";
      badge.textContent = "Finalizado";
      const name = document.createElement("span");
      name.className = "day-agenda-name";
      name.textContent = r.clientName;
      body.appendChild(badge);
      body.appendChild(name);
      if (r.serviceName) {
        const svc = document.createElement("span");
        svc.className = "day-agenda-service";
        svc.textContent = r.serviceName;
        body.appendChild(svc);
      }
    } else if (r.state === "in_progress") {
      row.classList.add("is-progress");
      const badge = document.createElement("span");
      badge.className = "agenda-badge agenda-badge-progress";
      badge.textContent = "Em atendimento";
      const name = document.createElement("span");
      name.className = "day-agenda-name";
      name.textContent = r.clientName;
      body.appendChild(badge);
      body.appendChild(name);
      if (r.serviceName) {
        const svc = document.createElement("span");
        svc.className = "day-agenda-service";
        svc.textContent = r.serviceName;
        body.appendChild(svc);
      }
    } else {
      row.classList.add("is-scheduled");
      const badge = document.createElement("span");
      badge.className = "agenda-badge agenda-badge-scheduled";
      badge.textContent = "Agendado";
      const name = document.createElement("span");
      name.className = "day-agenda-name";
      name.textContent = r.clientName;
      body.appendChild(badge);
      body.appendChild(name);
      if (r.pastDue) {
        const hint = document.createElement("span");
        hint.className = "day-agenda-past-hint";
        hint.textContent = "Horário já passou";
        body.appendChild(hint);
      }
      if (r.serviceName) {
        const svc = document.createElement("span");
        svc.className = "day-agenda-service";
        svc.textContent = r.serviceName;
        body.appendChild(svc);
      }
    }
    row.appendChild(time);
    row.appendChild(body);
    list.appendChild(row);
  });
  host.appendChild(list);
}

async function resolveAndLoad(slug) {
  const r = await resolveShopSlug(slug);
  if (!r) throw new Error("Barbearia não encontrada.");
  window.__shopId = r.shopId;
  window.__shopName = r.name || "";
  $("bookingTitle").textContent = r.name ? `Agendar — ${r.name}` : "Agendar";
  $("bookingSubtitle").textContent = r.name
    ? "Escolha data, barbeiro, serviço e horário."
    : "";
  showShopHeader(r.name || "");
  $("homeLanding").hidden = true;
  $("ownerPortal").hidden = true;
  $("app").hidden = false;
  setStatus("");
  await loadData(r.shopId);
}

async function loadData(shopId) {
  const barbers = await loadBarbers(shopId);
  const services = await loadServices(shopId);

  if (!barbers.length) throw new Error("Sem barbeiros cadastrados.");
  if (!services.length) throw new Error("Sem serviços cadastrados.");

  window.__barbers = barbers;
  window.__services = services;

  renderOptions(
    $("barberSelect"),
    barbers,
    (b) => b.id,
    (b) => b.name
  );
  renderOptions(
    $("serviceSelect"),
    services,
    (s) => s.id,
    (s) => `${s.name} (${priceToBRL(s.priceCents)})`
  );

  $("dateKey").value = toDateKey();
  await loadAvailability();
}

async function loadAvailability() {
  const shopId = window.__shopId;
  const dateKey = $("dateKey").value;
  const barberId = $("barberSelect").value;
  if (!shopId || !dateKey || !barberId) return;

  const slotsEl = $("slots");
  try {
    setStatus("Carregando horários...");
    const barber = (window.__barbers || []).find(function (b) {
      return b.id === barberId;
    });
    if (!barber) {
      setStatus("Barbeiro inválido.", true);
      return;
    }

    const appts = await appointmentsForDayDetailed(shopId, dateKey);
    const taken = new Set();
    appts.forEach(function (a) {
      if (a.barberId === barberId && a.status !== "CANCELLED") {
        taken.add(a.timeLabel);
      }
    });

    const forBarber = appts.filter(function (a) {
      return a.barberId === barberId && a.status !== "CANCELLED";
    });
    renderDayAgenda(barber, dateKey, forBarber);

    const rawSlots = window.NaReguaSchedule.availableSlotLabels(
      barber.scheduleByDay,
      dateKey,
      taken
    );
    const now = new Date();
    let slots = rawSlots.filter(function (t) {
      return !window.NaReguaSchedule.isSlotLabelPast(dateKey, t, now);
    });

    slotsEl.innerHTML = "";
    window.__selectedTimeLabel = null;

    if (!slots.length) {
      if (rawSlots.length) {
        slotsEl.innerHTML =
          '<p class="muted">Os horários deste dia para este barbeiro já passaram. Tente amanhã ou outro dia.</p>';
        setStatus("Sem horários futuros para marcar neste dia.");
      } else {
        slotsEl.innerHTML =
          '<p class="muted">Sem horários livres neste dia para este barbeiro.</p>';
        setStatus("Escolha outra data ou outro barbeiro.");
      }
      return;
    }

    slots.forEach(function (t) {
      const btn = document.createElement("button");
      btn.className = "slot";
      btn.type = "button";
      btn.textContent = t;
      btn.addEventListener("click", function () {
        window.__selectedTimeLabel = t;
        slotsEl.querySelectorAll(".slot").forEach(function (b) {
          b.classList.remove("selected");
        });
        btn.classList.add("selected");
      });
      slotsEl.appendChild(btn);
    });

    setStatus("Toque em um horário livre.");
  } catch (e) {
    slotsEl.innerHTML = "";
    setStatus(e.message || "Erro ao carregar horários.", true);
  }
}

function getSelectedService() {
  const serviceId = $("serviceSelect").value;
  return (window.__services || []).find(function (s) {
    return s.id === serviceId;
  });
}

async function book() {
  const shopId = window.__shopId;
  const barberId = $("barberSelect").value;
  const dateKey = $("dateKey").value;
  const timeLabel = window.__selectedTimeLabel;
  const clientName = $("clientName").value.trim();
  const clientPhone = $("clientPhone").value.trim();
  const service = getSelectedService();

  if (!clientName) return setStatus("Informe seu nome.", true);
  if (!clientPhone) return setStatus("Informe seu telefone.", true);
  if (!service) return setStatus("Selecione um serviço.", true);
  if (!timeLabel) return setStatus("Selecione um horário.", true);
  if (window.NaReguaSchedule.isSlotLabelPast(dateKey, timeLabel, new Date())) {
    return setStatus("Este horário já passou. Escolha outro.", true);
  }

  const barber = (window.__barbers || []).find(function (b) {
    return b.id === barberId;
  });
  if (!barber) return setStatus("Barbeiro inválido.", true);

  const baseSlots = window.NaReguaSchedule.availableSlotLabels(
    barber.scheduleByDay,
    dateKey,
    new Set()
  );
  if (baseSlots.indexOf(timeLabel) === -1) {
    return setStatus("Horário inválido para este barbeiro.", true);
  }

  setStatus("Confirmando agendamento...");

  const appointmentId = shopId + "_" + barberId + "_" + dateKey + "_" + timeLabel;
  const appointmentsCol = db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments");

  try {
    // Query não pode ir dentro de runTransaction no SDK compat — só DocumentReference.
    const daySnap = await appointmentsCol
      .where("dateKey", "==", dateKey)
      .get();
    const wantName = normalizeClientName(clientName);
    daySnap.docs.forEach(function (doc) {
      const d = doc.data();
      const st = d.status || "SCHEDULED";
      if (st === "CANCELLED") return;
      if (d.barberId === barberId && d.timeLabel === timeLabel) {
        throw new Error("Esse horário já foi ocupado.");
      }
      const other = normalizeClientName(d.clientName || "");
      if (wantName && other && wantName === other) {
        throw new Error("Já existe um agendamento com este nome neste dia.");
      }
    });

    const ref = appointmentsCol.doc(appointmentId);
    await db.runTransaction(async function (transaction) {
      const existing = await transaction.get(ref);
      if (existing.exists) {
        const st = existing.data().status || "SCHEDULED";
        if (st !== "CANCELLED") {
          throw new Error("Esse horário já foi ocupado.");
        }
      }
      transaction.set(ref, {
        shopId: shopId,
        barberId: barberId,
        dateKey: dateKey,
        timeLabel: timeLabel,
        clientName: clientName,
        clientPhone: clientPhone,
        serviceId: service.id,
        serviceName: service.name,
        servicePriceCents: service.priceCents,
        status: "SCHEDULED",
        createdBy: "CLIENT",
        appFeeCents: APP_FEE_CENTS,
      });
    });

    $("slots").querySelectorAll(".slot").forEach(function (b) {
      b.disabled = true;
    });
    setStatus("Agendamento confirmado. Referência: " + appointmentId + ".");
    await loadAvailability();
  } catch (e) {
    setStatus(e.message || "Não foi possível confirmar.", true);
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function defaultScheduleByDay() {
  const w = {
    isWorking: true,
    startTime: "09:00",
    endTime: "18:00",
    intervalMinutes: 30,
    lunchStart: "12:00",
    lunchEnd: "13:00",
  };
  const off = {
    isWorking: false,
    startTime: "09:00",
    endTime: "18:00",
    intervalMinutes: 30,
    lunchStart: null,
    lunchEnd: null,
  };
  const o = {};
  for (let day = 1; day <= 5; day++) o[String(day)] = Object.assign({}, w);
  o["6"] = Object.assign({}, off);
  o["7"] = Object.assign({}, off);
  return o;
}

async function resolveOwnerShop(uid) {
  const snap = await db
    .collection("barbershops")
    .where("ownerUid", "==", uid)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { shopId: doc.id, name: doc.data().name || "" };
}

function showLandingHome() {
  $("homeLanding").hidden = false;
  $("ownerPortal").hidden = true;
  $("app").hidden = true;
}

function showOwnerPortalUI() {
  $("homeLanding").hidden = true;
  $("ownerPortal").hidden = false;
  $("app").hidden = true;
  $("loginCard").hidden = true;
  $("findStub").hidden = true;
  const t = $("ownerShopTitle");
  if (t) t.textContent = window.__ownerShopName || "Barbearia";
  hideShopHeader();
  switchOwnerTab("barbers");
}

function switchOwnerTab(name) {
  document.querySelectorAll(".owner-tab").forEach(function (b) {
    b.classList.toggle("is-active", b.getAttribute("data-owner-tab") === name);
  });
  const map = {
    barbers: $("ownerPanelBarbers"),
    agenda: $("ownerPanelAgenda"),
    menu: $("ownerPanelMenu"),
    finance: $("ownerPanelFinance"),
  };
  Object.keys(map).forEach(function (k) {
    const el = map[k];
    if (el) el.hidden = k !== name;
  });
  if (name === "barbers") {
    loadOwnerBarbersPanel().catch(function () {});
  } else if (name === "agenda") {
    loadOwnerAgendaPanel().catch(function () {});
  } else if (name === "menu") {
    loadOwnerMenuPanel().catch(function () {});
  } else if (name === "finance") {
    loadOwnerFinancePanel().catch(function () {});
  }
}

async function loadOwnerBarbersPanel() {
  const shopId = window.__ownerShopId;
  const listEl = $("ownerBarbersList");
  if (!shopId || !listEl) return;
  setOwnerStatus("");
  const barbers = await loadBarbers(shopId);
  listEl.innerHTML = "";
  if (!barbers.length) {
    listEl.innerHTML = '<p class="muted">Ainda sem barbeiros. Adicione abaixo.</p>';
    return;
  }
  barbers.forEach(function (b) {
    const d = document.createElement("div");
    d.className = "owner-list-item";
    d.textContent = b.name;
    listEl.appendChild(d);
  });
}

async function loadOwnerMenuPanel() {
  const shopId = window.__ownerShopId;
  const listEl = $("ownerServicesList");
  if (!shopId || !listEl) return;
  const services = await loadServices(shopId);
  window.__ownerServicesCache = services;
  listEl.innerHTML = "";
  if (!services.length) {
    listEl.innerHTML = '<p class="muted">Sem serviços. Adicione abaixo.</p>';
    return;
  }
  services.forEach(function (s) {
    const row = document.createElement("div");
    row.className = "owner-service-edit-row";

    const nameLab = document.createElement("label");
    nameLab.className = "field owner-svc-field";
    const nameSpan = document.createElement("span");
    nameSpan.className = "field-label";
    nameSpan.textContent = "Nome";
    const nameIn = document.createElement("input");
    nameIn.type = "text";
    nameIn.required = true;
    nameIn.value = s.name;
    nameLab.appendChild(nameSpan);
    nameLab.appendChild(nameIn);

    const priceLab = document.createElement("label");
    priceLab.className = "field owner-svc-field";
    const priceSpan = document.createElement("span");
    priceSpan.className = "field-label";
    priceSpan.textContent = "Preço (R$)";
    const priceIn = document.createElement("input");
    priceIn.type = "number";
    priceIn.step = "0.01";
    priceIn.min = "0";
    priceIn.required = true;
    priceIn.value = (s.priceCents / 100).toFixed(2);
    priceLab.appendChild(priceSpan);
    priceLab.appendChild(priceIn);

    const durLab = document.createElement("label");
    durLab.className = "field owner-svc-field owner-svc-field-narrow";
    const durSpan = document.createElement("span");
    durSpan.className = "field-label";
    durSpan.textContent = "Duração média (min)";
    const durIn = document.createElement("input");
    durIn.type = "number";
    durIn.min = "5";
    durIn.step = "5";
    durIn.value = String(s.durationMinutes);
    durLab.appendChild(durSpan);
    durLab.appendChild(durIn);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-filled btn-sm owner-svc-save";
    saveBtn.textContent = "Salvar";

    saveBtn.addEventListener("click", async function () {
      const name = nameIn.value.trim();
      const price = parseFloat(priceIn.value);
      const dur = parseInt(durIn.value, 10) || 30;
      if (!name || isNaN(price)) {
        setOwnerStatus("Preencha nome e preço válidos.", true);
        return;
      }
      const cents = Math.round(price * 100);
      const durationMinutes = Math.max(5, dur);
      try {
        await db
          .collection("barbershops")
          .doc(shopId)
          .collection("services")
          .doc(s.id)
          .update({
            name: name,
            priceCents: cents,
            durationMinutes: durationMinutes,
          });
        await loadOwnerMenuPanel();
        setOwnerStatus("Serviço atualizado.");
      } catch (e) {
        setOwnerStatus(e.message || "Erro ao salvar.", true);
      }
    });

    row.appendChild(nameLab);
    row.appendChild(priceLab);
    row.appendChild(durLab);
    row.appendChild(saveBtn);
    listEl.appendChild(row);
  });
}

async function loadOwnerFinancePanel() {
  const shopId = window.__ownerShopId;
  if (!shopId) return;
  const now = new Date();
  const y = now.getFullYear();
  const mo = now.getMonth() + 1;
  const start = y + "-" + String(mo).padStart(2, "0") + "-01";
  const lastDay = new Date(y, mo, 0).getDate();
  const end =
    y + "-" + String(mo).padStart(2, "0") + "-" + String(lastDay).padStart(2, "0");
  const snap = await db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments")
    .where("dateKey", ">=", start)
    .where("dateKey", "<=", end)
    .get();
  let sum = 0;
  snap.docs.forEach(function (doc) {
    const d = doc.data();
    if ((d.createdBy || "") === "CLIENT" && (d.appFeeCents || 0) > 0) {
      sum += Number(d.appFeeCents);
    }
  });
  const blurb = $("ownerFinanceBlurb");
  if (blurb) {
    blurb.textContent =
      "Total referente a agendamentos feitos pelo cliente (taxa do app) no mês " +
      mo +
      "/" +
      y +
      ".";
  }
  const tot = $("ownerFinanceTotal");
  if (tot) tot.textContent = priceToBRL(sum);
}

async function addOwnerDelayMinutes(shopId, dateKey, barberId, delta) {
  const docId = dateKey + "_" + barberId;
  const ref = db
    .collection("barbershops")
    .doc(shopId)
    .collection("barberDayState")
    .doc(docId);
  await ref.set(
    {
      delayMinutes: firebase.firestore.FieldValue.increment(delta),
      dateKey: dateKey,
      barberId: barberId,
    },
    { merge: true }
  );
}

function appendOwnerSlotActions(body, r, shopId) {
  const id = r.appointmentId;
  if (!id) return;
  const wrap = document.createElement("div");
  wrap.className = "owner-slot-actions";
  if (r.state === "scheduled") {
    const st = document.createElement("button");
    st.type = "button";
    st.textContent = "Start";
    st.addEventListener("click", function () {
      ownerStartAppointment(shopId, id).catch(function (e) {
        setOwnerStatus(e.message || "Erro", true);
      });
    });
    wrap.appendChild(st);
  }
  if (r.state === "scheduled" || r.state === "in_progress") {
    const fn = document.createElement("button");
    fn.type = "button";
    fn.textContent = "Finalizar";
    fn.addEventListener("click", function () {
      ownerFinishAppointment(shopId, id, r).catch(function (e) {
        setOwnerStatus(e.message || "Erro", true);
      });
    });
    wrap.appendChild(fn);
    const cx = document.createElement("button");
    cx.type = "button";
    cx.className = "danger";
    cx.textContent = "Cancelar";
    cx.addEventListener("click", function () {
      ownerCancelAppointment(shopId, id).catch(function (e) {
        setOwnerStatus(e.message || "Erro", true);
      });
    });
    wrap.appendChild(cx);
  }
  body.appendChild(wrap);
}

async function ownerStartAppointment(shopId, apptId) {
  const ref = db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments")
    .doc(apptId);
  await ref.update({
    status: "IN_PROGRESS",
    actualStartAtMillis: Date.now(),
  });
  await loadOwnerAgendaPanel();
  setOwnerStatus("");
}

async function ownerCancelAppointment(shopId, apptId) {
  if (!confirm("Cancelar este agendamento?")) return;
  const ref = db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments")
    .doc(apptId);
  await ref.update({ status: "CANCELLED" });
  await loadOwnerAgendaPanel();
  setOwnerStatus("Agendamento cancelado.");
}

async function ownerFinishAppointment(shopId, apptId, r) {
  const svc = r.servicePriceCents || 0;
  const fee = r.appFeeCents || 0;
  const total = svc + fee;
  const msg =
    "Total a cobrar: " +
    priceToBRL(total) +
    (fee > 0 ? " (inclui taxa app " + priceToBRL(fee) + ")" : "");
  if (!confirm(msg + "\n\nMarcar atendimento como finalizado?")) return;
  const ref = db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments")
    .doc(apptId);
  await ref.update({
    status: "DONE",
    actualEndAtMillis: Date.now(),
  });
  await loadOwnerAgendaPanel();
  setOwnerStatus("Atendimento finalizado.");
}

function renderOwnerAgendaRow(rowEl, r, shopId, barberId, dateKey, barber) {
  rowEl.className = "day-agenda-row";
  if (r.state === "lunch") rowEl.classList.add("is-lunch");
  else if (r.state === "past") rowEl.classList.add("is-past");
  else if (r.state === "free") rowEl.classList.add("is-free");
  else if (r.state === "done") rowEl.classList.add("is-done");
  else if (r.state === "in_progress") rowEl.classList.add("is-progress");
  else if (r.state === "scheduled") rowEl.classList.add("is-scheduled");

  const time = document.createElement("span");
  time.className = "day-agenda-time";
  time.textContent = r.timeLabel;
  const body = document.createElement("div");
  body.className = "day-agenda-body";

  if (r.state === "lunch") {
    const b = document.createElement("span");
    b.className = "agenda-badge agenda-badge-lunch";
    b.textContent = "Almoço";
    body.appendChild(b);
    const sub = document.createElement("span");
    sub.className = "day-agenda-lunch-sub";
    sub.textContent = r.lunchSubtitle || "";
    body.appendChild(sub);
  } else if (r.state === "past") {
    const b = document.createElement("span");
    b.className = "agenda-badge agenda-badge-past";
    b.textContent = LABEL_FREE_SLOT_PAST;
    body.appendChild(b);
  } else if (r.state === "free") {
    const b = document.createElement("span");
    b.className = "agenda-badge agenda-badge-free";
    b.textContent = "Livre";
    body.appendChild(b);
    const mb = document.createElement("button");
    mb.type = "button";
    mb.textContent = "Marcar (barbeiro)";
    mb.addEventListener("click", function () {
      openOwnerBookModal(shopId, barberId, dateKey, r.timeLabel, barber).catch(
        function (e) {
          setOwnerStatus(e.message || "Erro", true);
        }
      );
    });
    body.appendChild(mb);
  } else {
    const stLabel =
      r.state === "done"
        ? "Finalizado"
        : r.state === "in_progress"
          ? "Em atendimento"
          : "Agendado";
    const badge = document.createElement("span");
    badge.className =
      "agenda-badge agenda-badge-" +
      (r.state === "done"
        ? "done"
        : r.state === "in_progress"
          ? "progress"
          : "scheduled");
    badge.textContent = stLabel;
    body.appendChild(badge);
    const name = document.createElement("span");
    name.className = "day-agenda-name";
    name.textContent = r.clientName || "—";
    body.appendChild(name);
    if (r.pastDue) {
      const h = document.createElement("span");
      h.className = "day-agenda-past-hint";
      h.textContent = "Horário já passou";
      body.appendChild(h);
    }
    if (r.serviceName) {
      const svc = document.createElement("span");
      svc.className = "day-agenda-service";
      svc.textContent = r.serviceName;
      body.appendChild(svc);
    }
    appendOwnerSlotActions(body, r, shopId);
  }

  rowEl.appendChild(time);
  rowEl.appendChild(body);
}

async function loadOwnerAgendaPanel() {
  const shopId = window.__ownerShopId;
  const board = $("ownerAgendaBoard");
  const dateInput = $("ownerAgendaDate");
  if (!shopId || !board) return;
  const dateKey = dateInput && dateInput.value ? dateInput.value : toDateKey();
  if (dateInput) dateInput.value = dateKey;
  board.innerHTML = "";
  setOwnerStatus("A carregar agenda…");
  const barbers = await loadBarbers(shopId);
  const allAppts = await appointmentsForDayDetailed(shopId, dateKey);
  if (!barbers.length) {
    board.innerHTML = '<p class="muted">Cadastre barbeiros primeiro.</p>';
    setOwnerStatus("");
    return;
  }
  barbers.forEach(function (barber) {
    const col = document.createElement("div");
    col.className = "owner-agenda-col";
    const h4 = document.createElement("h4");
    h4.textContent = barber.name;
    col.appendChild(h4);
    const delayDiv = document.createElement("div");
    delayDiv.className = "owner-agenda-delay";
    [5, 10, 20].forEach(function (dm) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "+" + dm + " min";
      b.addEventListener("click", function () {
        addOwnerDelayMinutes(shopId, dateKey, barber.id, dm)
          .then(function () {
            return loadOwnerAgendaPanel();
          })
          .catch(function (e) {
            setOwnerStatus(e.message || "Erro", true);
          });
      });
      delayDiv.appendChild(b);
    });
    col.appendChild(delayDiv);
    const forBarber = allAppts.filter(function (a) {
      return a.barberId === barber.id && (a.status || "SCHEDULED") !== "CANCELLED";
    });
    const rows = window.NaReguaSchedule.buildDayAgendaList(
      barber.scheduleByDay,
      dateKey,
      forBarber,
      new Date()
    );
    const listHost = document.createElement("div");
    listHost.className = "day-agenda-list";
    rows.forEach(function (r) {
      const rowEl = document.createElement("div");
      renderOwnerAgendaRow(rowEl, r, shopId, barber.id, dateKey, barber);
      listHost.appendChild(rowEl);
    });
    col.appendChild(listHost);
    board.appendChild(col);
  });
  setOwnerStatus("");
}

function closeOwnerBookModal() {
  const ov = $("ownerModalOverlay");
  if (ov) ov.hidden = true;
  window.__ownerBookCtx = null;
}

async function openOwnerBookModal(shopId, barberId, dateKey, timeLabel, barber) {
  window.__ownerBookCtx = {
    shopId: shopId,
    barberId: barberId,
    dateKey: dateKey,
    timeLabel: timeLabel,
    barber: barber,
  };
  let services = window.__ownerServicesCache;
  if (!services || !services.length) {
    services = await loadServices(shopId);
    window.__ownerServicesCache = services;
  }
  const svcSel = $("ownerModalService");
  svcSel.innerHTML = "";
  if (!services.length) {
    setOwnerStatus("Cadastre serviços na secção Serviço primeiro.", true);
    return;
  }
  services.forEach(function (s) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name + " (" + priceToBRL(s.priceCents) + ")";
    svcSel.appendChild(opt);
  });
  const meta = $("ownerModalMeta");
  if (meta) {
    meta.textContent = barber.name + " · " + timeLabel + " · " + dateKey;
  }
  $("ownerModalClientName").value = "";
  $("ownerModalOverlay").hidden = false;
}

async function confirmOwnerBookModal() {
  const ctx = window.__ownerBookCtx;
  if (!ctx) return;
  const name = $("ownerModalClientName").value.trim();
  const serviceId = $("ownerModalService").value;
  const service = (window.__ownerServicesCache || []).find(function (s) {
    return s.id === serviceId;
  });
  if (!name) {
    setOwnerStatus("Informe o nome do cliente.", true);
    return;
  }
  if (!service) {
    setOwnerStatus("Selecione um serviço.", true);
    return;
  }
  const shopId = ctx.shopId;
  const dateKey = ctx.dateKey;
  const daySnap = await db
    .collection("barbershops")
    .doc(shopId)
    .collection("appointments")
    .where("dateKey", "==", dateKey)
    .get();
  const wantName = normalizeClientName(name);
  try {
    daySnap.docs.forEach(function (doc) {
      const d = doc.data();
      const st = d.status || "SCHEDULED";
      if (st === "CANCELLED") return;
      const other = normalizeClientName(d.clientName || "");
      if (wantName && other && wantName === other) {
        throw new Error("Já existe um agendamento com este nome neste dia.");
      }
    });
  } catch (e) {
    setOwnerStatus(e.message || "Erro", true);
    return;
  }
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(36).slice(2);
  try {
    await db
      .collection("barbershops")
      .doc(shopId)
      .collection("appointments")
      .doc(id)
      .set({
        shopId: shopId,
        barberId: ctx.barberId,
        dateKey: dateKey,
        timeLabel: ctx.timeLabel,
        clientName: name,
        serviceId: service.id,
        serviceName: service.name,
        servicePriceCents: service.priceCents,
        status: "SCHEDULED",
        createdBy: "BARBER",
        appFeeCents: 0,
      });
    closeOwnerBookModal();
    await loadOwnerAgendaPanel();
    setOwnerStatus("Horário marcado.");
  } catch (e) {
    setOwnerStatus(e.message || "Erro ao marcar.", true);
  }
}

async function ownerLoginSubmit() {
  setHomeStatus("A entrar…");
  const email = $("ownerEmail").value.trim();
  const password = $("ownerPassword").value;
  if (!email || !password) {
    setHomeStatus("Preencha e-mail e senha.", true);
    return;
  }
  await initFirebaseCore();
  try {
    await firebase.auth().signOut();
    await firebase.auth().signInWithEmailAndPassword(email, password);
    const uid = firebase.auth().currentUser.uid;
    const snap = await db
      .collection("barbershops")
      .where("ownerUid", "==", uid)
      .limit(1)
      .get();
    if (snap.empty) {
      await firebase.auth().signOut();
      throw new Error(
        "Nenhuma barbearia ligada a esta conta. O cadastro é feito no aplicativo Android."
      );
    }
    const doc = snap.docs[0];
    window.__ownerShopId = doc.id;
    window.__ownerShopName = doc.data().name || "";
    setHomeStatus("");
    showOwnerPortalUI();
  } catch (e) {
    let msg = e.message || "Falha ao entrar.";
    if (e.code === "auth/wrong-password" || e.code === "auth/user-not-found") {
      msg = "E-mail ou senha incorretos.";
    }
    if (e.code === "auth/invalid-email") {
      msg = "E-mail inválido.";
    }
    setHomeStatus(msg, true);
  }
}

async function ownerLogoutClick() {
  await firebase.auth().signOut();
  window.__ownerShopId = null;
  window.__ownerShopName = null;
  $("ownerPassword").value = "";
  showLandingHome();
  $("loginCard").hidden = true;
  $("findStub").hidden = true;
  setOwnerStatus("");
}

async function init() {
  try {
    await initFirebaseCore();
  } catch (e) {
    setHomeStatus(e.message || "Erro ao iniciar Firebase.", true);
    return;
  }

  firebase.auth().onAuthStateChanged(async function (user) {
    if (getSlugFromPath()) return;
    if (!user || user.isAnonymous) return;
    try {
      const r = await resolveOwnerShop(user.uid);
      if (!r) return;
      window.__ownerShopId = r.shopId;
      window.__ownerShopName = r.name;
      const appEl = $("app");
      if (appEl && !appEl.hidden) return;
      const loginOpen = $("loginCard") && !$("loginCard").hidden;
      if (loginOpen) return;
      showOwnerPortalUI();
    } catch (e) {
      /* ignore */
    }
  });

  $("btnLoginShop").addEventListener("click", function () {
    $("loginCard").hidden = false;
    $("findStub").hidden = true;
    setHomeStatus("");
  });
  $("btnFindShop").addEventListener("click", function () {
    $("findStub").hidden = false;
    $("loginCard").hidden = true;
    setHomeStatus("");
  });
  $("ownerLoginCancel").addEventListener("click", function () {
    $("loginCard").hidden = true;
    setHomeStatus("");
  });
  $("findStubBack").addEventListener("click", function () {
    $("findStub").hidden = true;
  });
  $("ownerLoginSubmit").addEventListener("click", function () {
    ownerLoginSubmit().catch(function (e) {
      setHomeStatus(e.message || "Erro", true);
    });
  });
  $("ownerLogoutBtn").addEventListener("click", function () {
    ownerLogoutClick().catch(function () {});
  });

  document.querySelectorAll(".owner-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      switchOwnerTab(btn.getAttribute("data-owner-tab"));
    });
  });

  $("ownerAddBarberForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    const shopId = window.__ownerShopId;
    const name = $("ownerNewBarberName").value.trim();
    if (!name || !shopId) return;
    const ref = db
      .collection("barbershops")
      .doc(shopId)
      .collection("barbers")
      .doc();
    try {
      await ref.set({
        name: name,
        shopId: shopId,
        scheduleByDay: defaultScheduleByDay(),
      });
      $("ownerNewBarberName").value = "";
      await loadOwnerBarbersPanel();
      setOwnerStatus("Barbeiro adicionado.");
    } catch (e) {
      setOwnerStatus(e.message || "Erro", true);
    }
  });

  $("ownerAddServiceForm").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    const shopId = window.__ownerShopId;
    const name = $("ownerSvcName").value.trim();
    const price = parseFloat($("ownerSvcPrice").value);
    const dur = parseInt($("ownerSvcDuration").value, 10) || 30;
    if (!name || !shopId || isNaN(price)) return;
    const cents = Math.round(price * 100);
    try {
      await db
        .collection("barbershops")
        .doc(shopId)
        .collection("services")
        .doc()
        .set({
          name: name,
          priceCents: cents,
          durationMinutes: dur,
          shopId: shopId,
        });
      $("ownerSvcName").value = "";
      $("ownerSvcPrice").value = "";
      await loadOwnerMenuPanel();
      setOwnerStatus("Serviço adicionado.");
    } catch (e) {
      setOwnerStatus(e.message || "Erro", true);
    }
  });

  $("ownerAgendaDate").addEventListener("change", function () {
    loadOwnerAgendaPanel().catch(function () {});
  });

  $("ownerModalCancel").addEventListener("click", closeOwnerBookModal);
  $("ownerModalConfirm").addEventListener("click", function () {
    confirmOwnerBookModal().catch(function (e) {
      setOwnerStatus(e.message || "Erro", true);
    });
  });
  $("ownerModalOverlay").addEventListener("click", function (ev) {
    if (ev.target === $("ownerModalOverlay")) closeOwnerBookModal();
  });

  $("dateKey").addEventListener("change", loadAvailability);
  $("barberSelect").addEventListener("change", loadAvailability);
  $("bookBtn").addEventListener("click", function () {
    book().catch(function (e) {
      setStatus(e.message || "Erro ao agendar.", true);
    });
  });

  const slugFromPath = getSlugFromPath();
  const queryShopId = getQueryParam("shopId");

  if (slugFromPath) {
    setHomeStatus("A abrir barbearia…");
    try {
      await ensureAnonymousForPublicBooking();
      await resolveAndLoad(slugFromPath);
      setHomeStatus("");
    } catch (e) {
      setHomeStatus(
        e.message || "Barbearia não encontrada. Verifique o link.",
        true
      );
      $("homeLanding").hidden = false;
      $("app").hidden = true;
    }
    return;
  }

  if (queryShopId && queryShopId.trim()) {
    try {
      await ensureAnonymousForPublicBooking();
      window.__shopId = queryShopId.trim();
      $("homeLanding").hidden = true;
      $("ownerPortal").hidden = true;
      $("app").hidden = false;
      $("bookingTitle").textContent = "Agendar";
      $("bookingSubtitle").textContent =
        "Escolha data, barbeiro, serviço e horário.";
      hideShopHeader();
      setStatus("");
      await loadData(window.__shopId);
    } catch (e) {
      setHomeStatus(e.message || "Erro ao carregar.", true);
      $("homeLanding").hidden = false;
      $("app").hidden = true;
    }
    return;
  }

  $("homeLanding").hidden = false;
}

init();
