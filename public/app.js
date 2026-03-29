const apiBase = "/api";
const $ = (id) => document.getElementById(id);

function toDateKey(date = new Date()) {
  // YYYY-MM-DD no horário local do navegador
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
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

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.style.color = isError ? "var(--danger)" : "var(--ok)";
}

function priceToBRL(cents) {
  const val = cents / 100;
  return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function loadData(shopId) {
  const [barbersRes, servicesRes] = await Promise.all([
    fetchJson(`${apiBase}?action=barbers&shopId=${encodeURIComponent(shopId)}`),
    fetchJson(`${apiBase}?action=services&shopId=${encodeURIComponent(shopId)}`),
  ]);

  const barbers = barbersRes.barbers || [];
  const services = servicesRes.services || [];

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

  // default: primeira opção
  $("dateKey").value = toDateKey();
  $("app").style.display = "block";
  await loadAvailability();
}

async function loadAvailability() {
  const shopId = window.__shopId;
  const dateKey = $("dateKey").value;
  const barberId = $("barberSelect").value;
  if (!shopId || !dateKey || !barberId) return;

  setStatus("Carregando horários...");
  const res = await fetchJson(
    `${apiBase}?action=availability&shopId=${encodeURIComponent(shopId)}&dateKey=${encodeURIComponent(
      dateKey
    )}&barberId=${encodeURIComponent(barberId)}`
  );
  const slots = res.slots || [];

  const slotsEl = $("slots");
  slotsEl.innerHTML = "";
  window.__selectedTimeLabel = null;

  if (!slots.length) {
    slotsEl.innerHTML = `<p class="muted">Sem horários livres nesse dia/para esse barbeiro.</p>`;
    return;
  }

  for (const t of slots) {
    const btn = document.createElement("button");
    btn.className = "slot";
    btn.type = "button";
    btn.textContent = t;
    btn.addEventListener("click", () => {
      window.__selectedTimeLabel = t;
      // marca visualmente
      for (const b of slotsEl.querySelectorAll(".slot")) b.classList.remove("selected");
      btn.classList.add("selected");
    });
    slotsEl.appendChild(btn);
  }

  setStatus(`Escolha um horário (livre).`);
}

function getSelectedService() {
  const serviceId = $("serviceSelect").value;
  return (window.__services || []).find((s) => s.id === serviceId) || null;
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

  setStatus("Confirmando agendamento...");
  const payload = {
    shopId,
    barberId,
    dateKey,
    timeLabel,
    clientName,
    clientPhone,
    serviceId: service.id,
  };

  const r = await fetchJson(`${apiBase}?action=book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  $("slots").querySelectorAll(".slot").forEach((b) => (b.disabled = true));
  setStatus(`Agendamento confirmado! ID: ${r.appointmentId || "-"}`);
  await loadAvailability(); // atualiza a lista
}

async function init() {
  const queryShopId = getQueryParam("shopId");
  const shopIdInput = $("shopIdInput");
  const loadShopBtn = $("loadShopBtn");

  if (queryShopId) {
    shopIdInput.value = queryShopId;
  }

  loadShopBtn.addEventListener("click", async () => {
    const shopId = shopIdInput.value.trim();
    if (!shopId) return setStatus("Digite o shopId.", true);
    window.__shopId = shopId;
    $("shopPicker").style.display = "none";
    $("app").style.display = "block";
    try {
      setStatus("Carregando barbearia...");
      await loadData(shopId);
    } catch (e) {
      $("shopPicker").style.display = "block";
      $("app").style.display = "none";
      setStatus(e.message || "Erro ao carregar.", true);
    }
  });

  $("dateKey").addEventListener("change", loadAvailability);
  $("barberSelect").addEventListener("change", loadAvailability);
  $("bookBtn").addEventListener("click", book);

  // auto-load se shopId vier no query string
  if (queryShopId) {
    loadShopBtn.click();
  }
}

init();

