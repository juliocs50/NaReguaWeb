/**
 * Igual a functions/src/scheduleEngine.ts e ScheduleEngine.kt no Android.
 */
(function () {
  function parseMinutes(s) {
    const t = String(s).trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return h * 60 + min;
  }

  function formatMinutes(total) {
    const h = Math.floor(total / 60);
    const mm = total % 60;
    return String(h).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  }

  function generateBaseSlotLabels(day) {
    const start = parseMinutes(day.startTime);
    const end = parseMinutes(day.endTime);
    if (start == null || end == null) return [];
    const step = Math.max(5, day.intervalMinutes || 30);
    const lunchStart = day.lunchStart ? parseMinutes(day.lunchStart) : null;
    const lunchEnd = day.lunchEnd ? parseMinutes(day.lunchEnd) : null;
    const result = [];
    let t = start;
    while (t < end) {
      if (
        lunchStart != null &&
        lunchEnd != null &&
        t >= lunchStart &&
        t < lunchEnd
      ) {
        t += step;
        continue;
      }
      if (t + step > end) break;
      result.push(formatMinutes(t));
      t += step;
    }
    return result;
  }

  function javaDayOfWeekFromDateKey(dateKey) {
    const parts = dateKey.split("-").map(function (x) {
      return parseInt(x, 10);
    });
    const y = parts[0];
    const mo = parts[1];
    const d = parts[2];
    const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
    const js = dt.getUTCDay();
    return js === 0 ? 7 : js;
  }

  function parseScheduleFromFirestore(raw) {
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    Object.keys(raw).forEach(function (k) {
      const day = parseInt(k, 10);
      if (isNaN(day)) return;
      const v = raw[k];
      out[day] = {
        isWorking: !!v.isWorking,
        startTime: String(v.startTime != null ? v.startTime : "09:00"),
        endTime: String(v.endTime != null ? v.endTime : "18:00"),
        intervalMinutes: Number(v.intervalMinutes != null ? v.intervalMinutes : 30),
        lunchStart: v.lunchStart != null ? String(v.lunchStart) : null,
        lunchEnd: v.lunchEnd != null ? String(v.lunchEnd) : null,
      };
    });
    return out;
  }

  function availableSlotLabels(scheduleByDay, dateKey, takenSet) {
    const dow = javaDayOfWeekFromDateKey(dateKey);
    const daySchedule = scheduleByDay[dow];
    if (!daySchedule || !daySchedule.isWorking) return [];
    return generateBaseSlotLabels(daySchedule).filter(function (l) {
      return !takenSet.has(l);
    });
  }

  /** Todos os slots base do dia (para grade da agenda). */
  function generateBaseSlotLabelsForDay(scheduleByDay, dateKey) {
    const dow = javaDayOfWeekFromDateKey(dateKey);
    const daySchedule = scheduleByDay[dow];
    if (!daySchedule || !daySchedule.isWorking) return [];
    return generateBaseSlotLabels(daySchedule);
  }

  function todayDateKey(now) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  /**
   * Compara data do agendamento (YYYY-MM-DD) com o relógio local do navegador.
   * Slot "passou" no mesmo dia quando os minutos atuais são maiores que o início do slot.
   */
  function isSlotLabelPast(dateKey, timeLabel, now) {
    now = now || new Date();
    if (!timeLabel) return false;
    const today = todayDateKey(now);
    if (dateKey < today) return true;
    if (dateKey > today) return false;
    const sm = parseMinutes(timeLabel);
    if (sm == null) return false;
    const nm = now.getHours() * 60 + now.getMinutes();
    return nm > sm;
  }

  function appointmentRowFromDoc(a) {
    const st = a.status || "SCHEDULED";
    const base = {
      timeLabel: a.timeLabel,
      serviceName: a.serviceName || "",
      appointmentId: a.id || a.appointmentId || null,
      servicePriceCents:
        a.servicePriceCents != null ? Number(a.servicePriceCents) : 0,
      appFeeCents: a.appFeeCents != null ? Number(a.appFeeCents) : 0,
    };
    if (st === "DONE") {
      return Object.assign({}, base, {
        state: "done",
        clientName: a.clientName || "—",
      });
    }
    if (st === "IN_PROGRESS") {
      return Object.assign({}, base, {
        state: "in_progress",
        clientName: a.clientName || "—",
      });
    }
    return Object.assign({}, base, {
      state: "scheduled",
      clientName: a.clientName || "—",
    });
  }

  /**
   * Grade completa do dia: horários de atendimento (livre/ocupado/finalizado),
   * bloco de almoço (pausa — não aparecia antes) e marcações em horários fora da grade.
   */
  function buildDayAgendaList(scheduleByDay, dateKey, appointmentsForBarber, now) {
    now = now || new Date();
    const dow = javaDayOfWeekFromDateKey(dateKey);
    const day = scheduleByDay[dow];
    if (!day || !day.isWorking) return [];

    var lunchStart = day.lunchStart ? parseMinutes(day.lunchStart) : null;
    var lunchEnd = day.lunchEnd ? parseMinutes(day.lunchEnd) : null;
    if (
      lunchStart == null ||
      lunchEnd == null ||
      lunchStart >= lunchEnd
    ) {
      lunchStart = null;
      lunchEnd = null;
    }

    const active = appointmentsForBarber.filter(function (a) {
      return (a.status || "SCHEDULED") !== "CANCELLED";
    });

    const byTime = {};
    active.forEach(function (a) {
      if (a.timeLabel) byTime[a.timeLabel] = a;
    });

    const start = parseMinutes(day.startTime);
    const end = parseMinutes(day.endTime);
    if (start == null || end == null) return [];
    const step = Math.max(5, day.intervalMinutes || 30);

    function inLunch(t) {
      return lunchStart != null && lunchEnd != null && t >= lunchStart && t < lunchEnd;
    }

    const coveredSlotLabels = {};
    const items = [];

    let t = start;
    while (t < end) {
      if (inLunch(t)) {
        const rangeLabel =
          formatMinutes(lunchStart) + " – " + formatMinutes(lunchEnd);
        items.push({
          sortKey: lunchStart,
          row: {
            timeLabel: rangeLabel,
            state: "lunch",
            lunchSubtitle: "Pausa / indisponível para marcação",
          },
        });
        t = lunchEnd;
        continue;
      }
      if (t + step > end) break;
      const label = formatMinutes(t);
      coveredSlotLabels[label] = true;
      const a = byTime[label];
      if (!a) {
        const past = isSlotLabelPast(dateKey, label, now);
        items.push({
          sortKey: parseMinutes(label) || 0,
          row: { timeLabel: label, state: past ? "past" : "free" },
        });
      } else {
        const row = appointmentRowFromDoc(a);
        if (
          row.state === "scheduled" &&
          isSlotLabelPast(dateKey, label, now)
        ) {
          row.pastDue = true;
        }
        items.push({
          sortKey: parseMinutes(label) || 0,
          row: row,
        });
      }
      t += step;
    }

    active.forEach(function (a) {
      if (!a.timeLabel) return;
      if (coveredSlotLabels[a.timeLabel]) return;
      const sk = parseMinutes(a.timeLabel);
      const row = appointmentRowFromDoc(a);
      if (
        row.state === "scheduled" &&
        isSlotLabelPast(dateKey, a.timeLabel, now)
      ) {
        row.pastDue = true;
      }
      items.push({
        sortKey: sk != null ? sk : 99999,
        row: row,
      });
    });

    items.sort(function (a, b) {
      return a.sortKey - b.sortKey;
    });
    return items.map(function (x) {
      return x.row;
    });
  }

  window.NaReguaSchedule = {
    parseScheduleFromFirestore: parseScheduleFromFirestore,
    availableSlotLabels: availableSlotLabels,
    javaDayOfWeekFromDateKey: javaDayOfWeekFromDateKey,
    generateBaseSlotLabelsForDay: generateBaseSlotLabelsForDay,
    buildDayAgendaList: buildDayAgendaList,
    isSlotLabelPast: isSlotLabelPast,
    todayDateKey: todayDateKey,
  };
})();
