/**
 * Agendamento direto no Firestore (igual conceito do app Android), com Auth anónima.
 * Requer: Firebase Console → Authentication → Sign-in method → Anonymous → Enable
 * Regras: firestore.rules com request.auth != null
 */
/* global firebase */

const $ = (id) => document.getElementById(id);

const APP_FEE_CENTS = 100;

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

function setPickerStatus(msg, isError = false) {
  const el = $("pickerStatus");
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

async function ensureFirebase() {
  if (db) return;
  if (!window.FIREBASE_CONFIG) {
    throw new Error("Falta firebase-config.js");
  }
  if (!firebase.apps.length) {
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }
  db = firebase.firestore();
  try {
    await firebase.auth().signInAnonymously();
  } catch (e) {
    throw new Error(
      "Login anónimo falhou. No Firebase Console → Authentication → Sign-in method, ative «Anónimo»."
    );
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

async function appointmentsForDay(shopId, dateKey) {
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
    };
  });
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
  $("shopPicker").hidden = true;
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

    const appts = await appointmentsForDay(shopId, dateKey);
    const taken = new Set();
    appts.forEach(function (a) {
      if (a.barberId === barberId && a.status !== "CANCELLED") {
        taken.add(a.timeLabel);
      }
    });

    const slots = window.NaReguaSchedule.availableSlotLabels(
      barber.scheduleByDay,
      dateKey,
      taken
    );

    slotsEl.innerHTML = "";
    window.__selectedTimeLabel = null;

    if (!slots.length) {
      slotsEl.innerHTML =
        '<p class="muted">Sem horários livres neste dia para este barbeiro.</p>';
      setStatus("Escolha outra data ou outro barbeiro.");
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
    daySnap.docs.forEach(function (doc) {
      const d = doc.data();
      if (
        d.barberId === barberId &&
        d.timeLabel === timeLabel &&
        (d.status || "SCHEDULED") !== "CANCELLED"
      ) {
        throw new Error("Esse horário já foi ocupado.");
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

async function init() {
  try {
    await ensureFirebase();
  } catch (e) {
    setPickerStatus(e.message || "Erro ao iniciar Firebase.", true);
    return;
  }

  const slugFromPath = getSlugFromPath();
  const queryShopId = getQueryParam("shopId");

  $("loadShopBtn").addEventListener("click", async function () {
    const shopId = $("shopIdInput").value.trim();
    if (!shopId) {
      setPickerStatus("Digite o shopId.", true);
      return;
    }
    setPickerStatus("Carregando…");
    window.__shopId = shopId;
    try {
      $("bookingTitle").textContent = "Agendar";
      $("bookingSubtitle").textContent =
        "Escolha data, barbeiro, serviço e horário.";
      $("shopPicker").hidden = true;
      $("app").hidden = false;
      hideShopHeader();
      setStatus("");
      await loadData(shopId);
      setPickerStatus("");
    } catch (e) {
      $("shopPicker").hidden = false;
      $("app").hidden = true;
      setPickerStatus(e.message || "Erro ao carregar.", true);
    }
  });

  $("dateKey").addEventListener("change", loadAvailability);
  $("barberSelect").addEventListener("change", loadAvailability);
  $("bookBtn").addEventListener("click", function () {
    book().catch(function (e) {
      setStatus(e.message || "Erro ao agendar.", true);
    });
  });

  if (slugFromPath) {
    setPickerStatus("Abrindo barbearia…");
    try {
      await resolveAndLoad(slugFromPath);
      setPickerStatus("");
    } catch (e) {
      setPickerStatus(
        e.message ||
          "Barbearia não encontrada. Verifique o nome no link ou use o shopId.",
        true
      );
      $("shopPicker").hidden = false;
      $("app").hidden = true;
    }
    return;
  }

  if (queryShopId) {
    $("shopIdInput").value = queryShopId;
    $("loadShopBtn").click();
  }
}

init();
