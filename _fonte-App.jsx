import { useState, useEffect, useMemo } from "react";

const DAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const uid = () => Math.random().toString(36).slice(2, 9);
const toKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const t2m = (t) => {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const m2t = (m) =>
  `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const durLabel = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return `${h}h${m}min`;
  if (h) return `${h}h`;
  return `${m}min`;
};
const KIND = {
  rotina: { label: "Rotina", cls: "bg-emerald-50 text-emerald-700" },
  evento: { label: "Evento", cls: "bg-amber-50 text-amber-700" },
  tarefa: { label: "Tarefa", cls: "bg-sky-50 text-sky-700" },
};
const windowLabel = (nb, na) => {
  if (nb && na) return `entre ${nb} e ${na}`;
  if (nb) return `a partir das ${nb}`;
  if (na) return `terminar até ${na}`;
  return "qualquer horário";
};

// ---------------- scheduler ----------------
const roundUp5 = (m) => Math.ceil(m / 5) * 5; // horarios sempre terminados em 0 ou 5

function findSlot(occupied, from, to, dur) {
  const blocks = occupied.filter((b) => b.end > from && b.start < to).sort((a, b) => a.start - b.start);
  let cursor = from;
  for (const b of blocks) {
    const start = roundUp5(cursor);
    if (b.start - start >= dur && start + dur <= to) return start;
    cursor = Math.max(cursor, b.end);
    if (cursor >= to) break;
  }
  const start = roundUp5(cursor);
  if (start + dur <= to) return start; // garante inicio + duracao <= limite
  return null;
}

function buildDay(data, dateKey, dow, nowMin) {
  const { recurring, dated, backlog, settings, overrides = {} } = data;
  const ov = overrides[dateKey] || {};
  const wakeMin = t2m(settings.wake || "08:00");
  let sleepMin = t2m(settings.sleep || "00:00");
  if (sleepMin <= wakeMin) sleepMin += 1440;

  const cand = [];
  const push = (it, kind) => {
    if (it.mode === "fixo") {
      const s = t2m(it.start);
      let e = t2m(it.end);
      if (s == null || e == null) return;
      if (e <= s) e += 1440;
      cand.push({ id: it.id, title: it.title, kind, len: e - s, fixedTime: s, endTime: e, nb: wakeMin, na: sleepMin, isFixed: true });
    } else {
      const len = it.duration || 60;
      const nb = it.notBefore ? Math.max(t2m(it.notBefore), wakeMin) : wakeMin;
      const na = it.notAfter ? Math.min(t2m(it.notAfter), sleepMin) : sleepMin;
      cand.push({ id: it.id, title: it.title, kind, len, nb, na, isFixed: false });
    }
  };
  recurring.filter((r) => r.days.includes(dow)).forEach((r) => push(r, "rotina"));
  dated.filter((t) => t.date === dateKey).forEach((t) => push(t, t.origin === "backlog" ? "tarefa" : "evento"));

  const occupied = [];
  const blocks = [];
  const flex = [];
  const skipped = [];

  for (const c of cand) {
    const o = ov[c.id];
    if (o?.skip) { skipped.push(c); continue; }
    if (o?.start != null) {
      occupied.push({ start: o.start, end: o.start + c.len });
      blocks.push({ ...c, start: o.start, end: o.start + c.len, pinned: true });
    } else if (c.isFixed) {
      occupied.push({ start: c.fixedTime, end: c.endTime });
      blocks.push({ ...c, start: c.fixedTime, end: c.endTime, fixedBlock: true });
    } else {
      flex.push(c);
    }
  }

  flex.sort((a, b) => a.na - a.nb - (b.na - b.nb) || b.len - a.len);
  const unplaced = [];
  for (const item of flex) {
    const slot = findSlot(occupied, item.nb, item.na, item.len);
    if (slot != null) {
      occupied.push({ start: slot, end: slot + item.len });
      blocks.push({ ...item, start: slot, end: slot + item.len, auto: true });
    } else unplaced.push(item);
  }
  blocks.sort((a, b) => a.start - b.start);
  blocks.forEach((b) => (b.past = nowMin != null && b.end <= nowMin));

  const suggestions = [];
  for (const b of backlog.filter((x) => !x.done)) {
    const dur = b.duration || 30;
    const nb = b.notBefore ? Math.max(t2m(b.notBefore), wakeMin) : wakeMin;
    const na = b.notAfter ? Math.min(t2m(b.notAfter), sleepMin) : sleepMin;
    const from = nowMin != null ? Math.max(nb, nowMin) : nb;
    const slot = findSlot(occupied, from, na, dur);
    if (slot != null) suggestions.push({ ...b, suggestedStart: slot, duration: dur });
  }

  return { blocks, unplaced, suggestions, skipped, wakeMin, sleepMin };
}

// ---------------- app ----------------
export default function App() {
  const [tab, setTab] = useState("hoje");
  const [loaded, setLoaded] = useState(false);

  const [recurring, setRecurring] = useState([]);
  const [dated, setDated] = useState([]);
  const [backlog, setBacklog] = useState([]);
  const [completions, setCompletions] = useState({});
  const [overrides, setOverrides] = useState({});
  const [settings, setSettings] = useState({ wake: "08:00", sleep: "00:00" });
  const [viewDate, setViewDate] = useState(new Date());
  const [now, setNow] = useState(new Date());
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("meudia-data");
        if (r && r.value) {
          const d = JSON.parse(r.value);
          setRecurring(d.recurring || []);
          setDated(d.dated || []);
          setBacklog(d.backlog || []);
          setCompletions(d.completions || {});
          setOverrides(d.overrides || {});
          setSettings(d.settings || { wake: "08:00", sleep: "00:00" });
        }
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        await window.storage.set("meudia-data", JSON.stringify({ recurring, dated, backlog, completions, overrides, settings }));
      } catch (e) { console.error(e); }
    })();
  }, [recurring, dated, backlog, completions, overrides, settings, loaded]);

  const dateKey = toKey(viewDate);
  const dow = viewDate.getDay();
  const isToday = toKey(now) === dateKey;
  const nowMin = isToday ? now.getHours() * 60 + now.getMinutes() : null;
  const doneToday = completions[dateKey] || [];

  const plan = useMemo(
    () => buildDay({ recurring, dated, backlog, settings, overrides }, dateKey, dow, nowMin),
    [recurring, dated, backlog, settings, overrides, dateKey, dow, nowMin]
  );

  const toggleDone = (id) =>
    setCompletions((prev) => {
      const list = prev[dateKey] || [];
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
      return { ...prev, [dateKey]: next };
    });

  const shiftDay = (n) => setViewDate((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));

  const setOverride = (itemId, patch) =>
    setOverrides((prev) => {
      const day = { ...(prev[dateKey] || {}) };
      day[itemId] = { ...(day[itemId] || {}), ...patch };
      return { ...prev, [dateKey]: day };
    });
  const clearOverride = (itemId) =>
    setOverrides((prev) => {
      const day = { ...(prev[dateKey] || {}) };
      delete day[itemId];
      return { ...prev, [dateKey]: day };
    });

  const moveItem = (item, time) => {
    const t = t2m(time);
    if (t == null) return;
    setOverride(item.id, { start: t, skip: false });
    setMsg("");
  };
  const skipItem = (item) => setOverride(item.id, { skip: true });

  const reallocate = (item) => {
    const others = plan.blocks.filter((b) => b.id !== item.id).map((b) => ({ start: b.start, end: b.end }));
    const from = Math.max(item.nb, nowMin != null ? nowMin : item.nb);
    const slot = findSlot(others, from, item.na, item.len);
    if (slot != null) { setOverride(item.id, { start: slot, skip: false }); setMsg(""); }
    else setMsg(`"${item.title}" não cabe mais tarde hoje dentro da restrição (${windowLabel(item.nb ? m2t(item.nb) : "", item.na ? m2t(item.na) : "")}).`);
  };

  const fazerHoje = (item) => {
    setDated((prev) => [...prev, { id: uid(), title: item.title, date: dateKey, mode: "duracao", duration: item.duration || 30, notBefore: item.notBefore || "", notAfter: item.notAfter || "", origin: "backlog" }]);
    setBacklog((prev) => prev.filter((b) => b.id !== item.id));
  };

  if (!loaded)
    return <div className="min-h-screen flex items-center justify-center bg-stone-50 text-stone-400 font-sans">Carregando…</div>;

  return (
    <div className="min-h-screen bg-stone-50 text-stone-800 font-sans">
      <div className="max-w-md mx-auto px-4 pb-24">
        <header className="pt-6 pb-4 flex items-start justify-between">
          <div>
            <h1 className="font-serif text-2xl text-emerald-900 tracking-tight">Meu Dia</h1>
            <p className="text-xs text-stone-500 mt-0.5">Você diz o que fazer e a duração — ele monta a agenda.</p>
          </div>
          <div className="text-right leading-tight pt-1">
            <div className="text-base font-medium text-stone-700 tabular-nums">{m2t(now.getHours() * 60 + now.getMinutes())}</div>
            <div className="text-[10px] text-stone-400">{DAY_SHORT[now.getDay()]} {String(now.getDate()).padStart(2, "0")}/{String(now.getMonth() + 1).padStart(2, "0")}</div>
          </div>
        </header>

        <div className="flex gap-1 mb-5 bg-stone-200/60 p-1 rounded-xl text-sm">
          {[["hoje", "Hoje"], ["gerenciar", "Rotinas & Tarefas"]].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex-1 py-2 rounded-lg transition ${tab === k ? "bg-white shadow-sm text-emerald-900 font-medium" : "text-stone-500"}`}>{label}</button>
          ))}
        </div>

        {msg && (
          <div className="mb-4 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
            <span className="flex-1">{msg}</span>
            <button onClick={() => setMsg("")} className="text-amber-500">✕</button>
          </div>
        )}

        {tab === "hoje" ? (
          <HojeView
            viewDate={viewDate} dow={dow} isToday={isToday} plan={plan} doneToday={doneToday}
            toggleDone={toggleDone} shiftDay={shiftDay} resetToday={() => setViewDate(new Date())}
            fazerHoje={fazerHoje} moveItem={moveItem} skipItem={skipItem} reallocate={reallocate}
            clearOverride={clearOverride}
          />
        ) : (
          <GerenciarView
            settings={settings} setSettings={setSettings}
            recurring={recurring} setRecurring={setRecurring}
            dated={dated} setDated={setDated} backlog={backlog} setBacklog={setBacklog}
          />
        )}
      </div>
    </div>
  );
}

function HojeView({ viewDate, dow, isToday, plan, doneToday, toggleDone, shiftDay, resetToday, fazerHoje, moveItem, skipItem, reallocate, clearOverride }) {
  const { blocks, unplaced, suggestions, skipped } = plan;
  const doneCount = blocks.filter((b) => doneToday.includes(b.id)).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => shiftDay(-1)} className="w-9 h-9 rounded-full hover:bg-stone-200 text-stone-500 text-lg">‹</button>
        <div className="text-center">
          <div className="font-serif text-lg text-stone-800">{DAY_LABELS[dow]}</div>
          <button onClick={resetToday} className={`text-xs ${isToday ? "text-emerald-700" : "text-stone-400 underline"}`}>{viewDate.toLocaleDateString("pt-BR")}{!isToday && " · voltar pra hoje"}</button>
        </div>
        <button onClick={() => shiftDay(1)} className="w-9 h-9 rounded-full hover:bg-stone-200 text-stone-500 text-lg">›</button>
      </div>

      {blocks.length > 0 && (
        <div className="mb-4 text-xs text-stone-500">
          {doneCount} de {blocks.length} concluídos
          <div className="mt-1 h-1.5 bg-stone-200 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-600 transition-all" style={{ width: `${(doneCount / blocks.length) * 100}%` }} />
          </div>
        </div>
      )}

      <section className="space-y-2 mb-6">
        {blocks.length === 0 && <p className="text-sm text-stone-400 py-6 text-center">Dia livre. Adicione rotinas ou puxe algo de "algum dia".</p>}
        {blocks.map((item) => (
          <Block key={item.id} item={item} done={doneToday.includes(item.id)} isToday={isToday}
            onToggle={() => toggleDone(item.id)} onMove={(t) => moveItem(item, t)} onSkip={() => skipItem(item)} onReallocate={() => reallocate(item)} />
        ))}
      </section>

      {unplaced.length > 0 && (
        <div className="mb-6 p-3 rounded-xl bg-red-50 border border-red-100">
          <p className="text-xs font-medium text-red-700 mb-1">Não coube na sua janela de hoje:</p>
          <ul className="text-xs text-red-600 space-y-0.5">
            {unplaced.map((u) => (<li key={u.id}>• {u.title} ({durLabel(u.len)}, {windowLabel(u.nb ? m2t(u.nb) : "", u.na ? m2t(u.na) : "")})</li>))}
          </ul>
        </div>
      )}

      {skipped.length > 0 && (
        <div className="mb-6 text-xs text-stone-400">
          {skipped.map((s) => (
            <div key={s.id} className="flex items-center gap-2 py-1">
              <span className="line-through flex-1">{s.title} — pulada hoje</span>
              <button onClick={() => clearOverride(s.id)} className="text-emerald-600 hover:underline">trazer de volta</button>
            </div>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <section>
          <h2 className="font-serif text-base text-stone-700 mb-2">Cabe hoje <span className="text-stone-400 font-sans text-xs">(da lista sem data)</span></h2>
          <div className="space-y-2">
            {suggestions.map((s) => (
              <div key={s.id} className="flex items-center gap-2 p-3 bg-white rounded-xl border border-stone-200 shadow-sm">
                <span className="flex-1 text-sm text-stone-700">{s.title}<span className="block text-[10px] text-stone-400">sugestão: {m2t(s.suggestedStart)} · {durLabel(s.duration)}</span></span>
                <button onClick={() => fazerHoje(s)} className="text-xs text-emerald-700 hover:bg-emerald-50 px-2 py-1 rounded-lg">encaixar hoje</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Block({ item, done, isToday, onToggle, onMove, onSkip, onReallocate }) {
  const [menu, setMenu] = useState(false);
  const [moving, setMoving] = useState(false);
  const [time, setTime] = useState(m2t(item.start));
  const latePending = isToday && item.past && !done;

  return (
    <div className={`rounded-xl border overflow-hidden ${done ? "bg-stone-100 border-stone-200" : latePending ? "bg-red-50 border-red-200" : "bg-white border-stone-200 shadow-sm"}`}>
      <div className="flex items-stretch gap-3">
        <div className={`w-16 shrink-0 flex flex-col items-center justify-center py-2 border-r ${latePending ? "bg-red-100/50 border-red-100" : "bg-stone-50 border-stone-100"}`}>
          <span className="text-sm font-medium text-stone-700 tabular-nums">{m2t(item.start)}</span>
          <span className="text-[10px] text-stone-400 tabular-nums">{m2t(item.end)}</span>
        </div>
        <button onClick={onToggle} className="flex-1 min-w-0 flex items-center gap-2 py-3 text-left">
          <span className={`w-5 h-5 rounded-md border flex items-center justify-center text-xs shrink-0 ${done ? "bg-emerald-600 border-emerald-600 text-white" : "border-stone-300"}`}>{done && "✓"}</span>
          <span className="flex-1 min-w-0">
            <span className={`block truncate ${done ? "line-through text-stone-400" : "text-stone-800"}`}>{item.title}</span>
            <span className="text-[10px] text-stone-400">{item.pinned ? "movida" : item.fixedBlock ? "horário fixo" : "encaixado"} · {durLabel(item.len)}{latePending && " · já passou"}</span>
          </span>
          <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0 ${(KIND[item.kind] || KIND.tarefa).cls}`}>{(KIND[item.kind] || KIND.tarefa).label}</span>
        </button>
        <button onClick={() => setMenu((m) => !m)} className="px-3 text-stone-400 hover:text-stone-600 text-lg shrink-0">⋯</button>
      </div>

      {latePending && !menu && (
        <div className="px-3 pb-2 -mt-1">
          <button onClick={onReallocate} className="text-xs bg-red-600 text-white px-2.5 py-1 rounded-lg hover:bg-red-700">realocar mais tarde</button>
        </div>
      )}

      {menu && (
        <div className="px-3 pb-3 pt-1 border-t border-stone-100 space-y-2">
          {!moving ? (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setMoving(true)} className="text-xs bg-stone-100 hover:bg-stone-200 px-2.5 py-1 rounded-lg text-stone-600">mudar horário</button>
              {latePending && <button onClick={() => { onReallocate(); setMenu(false); }} className="text-xs bg-stone-100 hover:bg-stone-200 px-2.5 py-1 rounded-lg text-stone-600">realocar mais tarde</button>}
              <button onClick={() => { onSkip(); setMenu(false); }} className="text-xs bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-lg text-red-600">pular hoje</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="px-2 py-1 rounded-lg border border-stone-200 text-sm" />
              <button onClick={() => { onMove(time); setMoving(false); setMenu(false); }} className="text-xs bg-emerald-600 text-white px-2.5 py-1 rounded-lg">ok</button>
              <button onClick={() => setMoving(false)} className="text-xs text-stone-400">cancelar</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- shared constraint fields ----------------
const DUR_PICKS = [["30 min", 30], ["45 min", 45], ["1 h", 60], ["1h30", 90], ["2 h", 120]];

function ConstraintFields({ settings, duration, setDuration, notBefore, setNotBefore, notAfter, setNotAfter, accent }) {
  const preset = (nb, na) => { setNotBefore(nb); setNotAfter(na); };
  const presets = [["Qualquer", "", ""], ["Manhã", settings.wake, "12:00"], ["Tarde", "12:00", "18:00"], ["Noite", "18:00", ""], ["De dia", "08:00", "18:00"]];
  return (
    <div className="space-y-2">
      <div>
        <span className="text-[11px] text-stone-400">Duração</span>
        <div className="flex flex-wrap gap-1 mt-1">
          {DUR_PICKS.map(([label, v]) => (<button key={v} onClick={() => setDuration(v)} className={`px-2.5 py-1 rounded-lg text-xs ${duration === v ? `${accent} text-white` : "bg-stone-100 text-stone-500 hover:bg-stone-200"}`}>{label}</button>))}
          <input type="number" min="5" step="5" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-16 px-2 py-1 rounded-lg border border-stone-200 text-xs" />
          <span className="text-xs text-stone-400 self-center">min</span>
        </div>
      </div>
      <div>
        <span className="text-[11px] text-stone-400">Quando pode ser encaixado</span>
        <div className="flex flex-wrap gap-1 mt-1">
          {presets.map(([label, nb, na]) => { const active = notBefore === nb && notAfter === na; return <button key={label} onClick={() => preset(nb, na)} className={`px-2.5 py-1 rounded-lg text-xs ${active ? `${accent} text-white` : "bg-stone-100 text-stone-500 hover:bg-stone-200"}`}>{label}</button>; })}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-stone-500">
          <span>começar a partir de</span>
          <input type="time" value={notBefore} onChange={(e) => setNotBefore(e.target.value)} className="px-2 py-1 rounded-lg border border-stone-200" />
          <span>terminar até</span>
          <input type="time" value={notAfter} onChange={(e) => setNotAfter(e.target.value)} className="px-2 py-1 rounded-lg border border-stone-200" />
        </div>
      </div>
    </div>
  );
}

function GerenciarView({ settings, setSettings, recurring, setRecurring, dated, setDated, backlog, setBacklog }) {
  return (
    <div className="space-y-8">
      <section className="bg-white rounded-xl border border-stone-200 p-3 shadow-sm">
        <h2 className="font-serif text-base text-stone-700 mb-1">Sua janela do dia</h2>
        <p className="text-xs text-stone-500 mb-2">Fora desse intervalo nada é agendado (seu sono).</p>
        <div className="flex items-center gap-2 text-sm text-stone-600">
          <span className="text-xs">acordo às</span>
          <input type="time" value={settings.wake} onChange={(e) => setSettings((s) => ({ ...s, wake: e.target.value }))} className="px-2 py-1 rounded-lg border border-stone-200" />
          <span className="text-xs">durmo às</span>
          <input type="time" value={settings.sleep} onChange={(e) => setSettings((s) => ({ ...s, sleep: e.target.value }))} className="px-2 py-1 rounded-lg border border-stone-200" />
        </div>
      </section>
      <RecurringManager settings={settings} recurring={recurring} setRecurring={setRecurring} />
      <DatedManager settings={settings} dated={dated} setDated={setDated} />
      <BacklogManager settings={settings} backlog={backlog} setBacklog={setBacklog} />
    </div>
  );
}

function RecurringManager({ settings, recurring, setRecurring }) {
  const [title, setTitle] = useState("");
  const [days, setDays] = useState([]);
  const [mode, setMode] = useState("duracao");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [duration, setDuration] = useState(60);
  const [notBefore, setNotBefore] = useState("");
  const [notAfter, setNotAfter] = useState("");
  const [editingId, setEditingId] = useState(null);

  const toggleDay = (d) => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));
  const reset = () => { setTitle(""); setDays([]); setMode("duracao"); setStart(""); setEnd(""); setDuration(60); setNotBefore(""); setNotAfter(""); setEditingId(null); };
  const startEdit = (r) => { setTitle(r.title); setDays(r.days); setMode(r.mode); setStart(r.start || ""); setEnd(r.end || ""); setDuration(r.duration || 60); setNotBefore(r.notBefore || ""); setNotAfter(r.notAfter || ""); setEditingId(r.id); };
  const save = () => {
    if (!title.trim() || days.length === 0) return;
    if (mode === "fixo" && (!start || !end)) return;
    const item = { title: title.trim(), days, mode, start: start || null, end: end || null, duration, notBefore, notAfter };
    if (editingId) setRecurring((p) => p.map((x) => (x.id === editingId ? { ...x, ...item } : x)));
    else setRecurring((p) => [...p, { id: uid(), ...item }]);
    reset();
  };

  return (
    <section>
      <h2 className="font-serif text-lg text-emerald-900 mb-1">Rotinas</h2>
      <p className="text-xs text-stone-500 mb-3">Repetem nos dias escolhidos. Diga a duração e ele encaixa; ou fixe um horário.</p>
      <div className={`rounded-xl border p-3 space-y-3 shadow-sm ${editingId ? "bg-emerald-50 border-emerald-200" : "bg-white border-stone-200"}`}>
        {editingId && <div className="text-xs text-emerald-700 font-medium">Editando rotina</div>}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Academia" className="w-full text-sm px-3 py-2 rounded-lg border border-stone-200 outline-none focus:border-emerald-400" />
        <div className="flex flex-wrap gap-1">
          {DAY_ORDER.map((d) => (<button key={d} onClick={() => toggleDay(d)} className={`w-9 h-9 rounded-lg text-xs ${days.includes(d) ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-500 hover:bg-stone-200"}`}>{DAY_SHORT[d]}</button>))}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setDays([1, 2, 3, 4, 5])} className="text-xs text-emerald-700 hover:underline">dias de semana</button>
          <button onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])} className="text-xs text-emerald-700 hover:underline">todos</button>
        </div>
        <div className="flex gap-1 bg-stone-100 p-1 rounded-lg text-xs">
          {[["duracao", "Encaixar (duração)"], ["fixo", "Horário fixo"]].map(([k, l]) => (<button key={k} onClick={() => setMode(k)} className={`flex-1 py-1.5 rounded-md ${mode === k ? "bg-white shadow-sm text-emerald-800 font-medium" : "text-stone-500"}`}>{l}</button>))}
        </div>
        {mode === "fixo" ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-stone-400">das</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="px-2 py-1 rounded-lg border border-stone-200 text-sm" />
            <span className="text-xs text-stone-400">às</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="px-2 py-1 rounded-lg border border-stone-200 text-sm" />
          </div>
        ) : (
          <ConstraintFields settings={settings} duration={duration} setDuration={setDuration} notBefore={notBefore} setNotBefore={setNotBefore} notAfter={notAfter} setNotAfter={setNotAfter} accent="bg-emerald-600" />
        )}
        <div className="flex gap-2">
          <button onClick={save} className="flex-1 py-2 bg-emerald-700 text-white rounded-lg text-sm font-medium hover:bg-emerald-800">{editingId ? "Salvar alteração" : "Adicionar rotina"}</button>
          {editingId && <button onClick={reset} className="px-3 py-2 text-sm text-stone-500 rounded-lg hover:bg-stone-100">cancelar</button>}
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {recurring.map((r) => (
          <div key={r.id} className="flex items-center gap-2 p-3 bg-white rounded-xl border border-stone-200">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-stone-800">{r.title}</div>
              <div className="text-xs text-stone-400">{DAY_ORDER.filter((d) => r.days.includes(d)).map((d) => DAY_SHORT[d]).join(", ")} · {r.mode === "fixo" ? `${r.start}–${r.end}` : `${durLabel(r.duration)}, ${windowLabel(r.notBefore, r.notAfter)}`}</div>
            </div>
            <button onClick={() => startEdit(r)} className="text-emerald-600 hover:bg-emerald-50 text-sm px-2 rounded">editar</button>
            <button onClick={() => setRecurring((p) => p.filter((x) => x.id !== r.id))} className="text-stone-300 hover:text-red-500 text-sm px-2">remover</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function DatedManager({ settings, dated, setDated }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [mode, setMode] = useState("fixo");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [duration, setDuration] = useState(60);
  const [notBefore, setNotBefore] = useState("");
  const [notAfter, setNotAfter] = useState("");
  const [editingId, setEditingId] = useState(null);

  const reset = () => { setTitle(""); setDate(""); setMode("fixo"); setStart(""); setEnd(""); setDuration(60); setNotBefore(""); setNotAfter(""); setEditingId(null); };
  const startEdit = (t) => { setTitle(t.title); setDate(t.date); setMode(t.mode); setStart(t.start || ""); setEnd(t.end || ""); setDuration(t.duration || 60); setNotBefore(t.notBefore || ""); setNotAfter(t.notAfter || ""); setEditingId(t.id); };
  const save = () => {
    if (!title.trim() || !date) return;
    if (mode === "fixo" && (!start || !end)) return;
    const item = { title: title.trim(), date, mode, start: start || null, end: end || null, duration, notBefore, notAfter };
    if (editingId) setDated((p) => p.map((x) => (x.id === editingId ? { ...x, ...item } : x)));
    else setDated((p) => [...p, { id: uid(), ...item }]);
    reset();
  };
  const future = [...dated].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <section>
      <h2 className="font-serif text-lg text-amber-800 mb-1">Tarefas com data</h2>
      <p className="text-xs text-stone-500 mb-3">Num dia específico. Horário fixo ou só duração pra ele encaixar.</p>
      <div className={`rounded-xl border p-3 space-y-3 shadow-sm ${editingId ? "bg-amber-50 border-amber-200" : "bg-white border-stone-200"}`}>
        {editingId && <div className="text-xs text-amber-700 font-medium">Editando tarefa</div>}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="O que é?" className="w-full text-sm px-3 py-2 rounded-lg border border-stone-200 outline-none focus:border-amber-400" />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-2 py-2 rounded-lg border border-stone-200 text-sm" />
        <div className="flex gap-1 bg-stone-100 p-1 rounded-lg text-xs">
          {[["fixo", "Horário fixo"], ["duracao", "Encaixar (duração)"]].map(([k, l]) => (<button key={k} onClick={() => setMode(k)} className={`flex-1 py-1.5 rounded-md ${mode === k ? "bg-white shadow-sm text-amber-800 font-medium" : "text-stone-500"}`}>{l}</button>))}
        </div>
        {mode === "fixo" ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-stone-400">das</span>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="px-2 py-1 rounded-lg border border-stone-200 text-sm" />
            <span className="text-xs text-stone-400">às</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="px-2 py-1 rounded-lg border border-stone-200 text-sm" />
          </div>
        ) : (
          <ConstraintFields settings={settings} duration={duration} setDuration={setDuration} notBefore={notBefore} setNotBefore={setNotBefore} notAfter={notAfter} setNotAfter={setNotAfter} accent="bg-amber-600" />
        )}
        <div className="flex gap-2">
          <button onClick={save} className="flex-1 py-2 bg-amber-700 text-white rounded-lg text-sm font-medium hover:bg-amber-800">{editingId ? "Salvar alteração" : "Adicionar tarefa"}</button>
          {editingId && <button onClick={reset} className="px-3 py-2 text-sm text-stone-500 rounded-lg hover:bg-stone-100">cancelar</button>}
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {future.map((t) => (
          <div key={t.id} className="flex items-center gap-2 p-3 bg-white rounded-xl border border-stone-200">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-stone-800">{t.title}</div>
              <div className="text-xs text-stone-400">{new Date(t.date + "T00:00").toLocaleDateString("pt-BR")} · {t.mode === "fixo" ? `${t.start}–${t.end}` : `${durLabel(t.duration)}, ${windowLabel(t.notBefore, t.notAfter)}`}</div>
            </div>
            <button onClick={() => startEdit(t)} className="text-amber-600 hover:bg-amber-50 text-sm px-2 rounded">editar</button>
            <button onClick={() => setDated((p) => p.filter((x) => x.id !== t.id))} className="text-stone-300 hover:text-red-500 text-sm px-2">remover</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function BacklogManager({ settings, backlog, setBacklog }) {
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);
  const [duration, setDuration] = useState(30);
  const [notBefore, setNotBefore] = useState("");
  const [notAfter, setNotAfter] = useState("");
  const [editingId, setEditingId] = useState(null);

  const reset = () => { setTitle(""); setDuration(30); setNotBefore(""); setNotAfter(""); setEditingId(null); setOpen(false); };
  const startEdit = (b) => { setTitle(b.title); setDuration(b.duration || 30); setNotBefore(b.notBefore || ""); setNotAfter(b.notAfter || ""); setEditingId(b.id); setOpen(true); };
  const save = () => {
    if (!title.trim()) return;
    const item = { title: title.trim(), duration, notBefore, notAfter };
    if (editingId) setBacklog((p) => p.map((x) => (x.id === editingId ? { ...x, ...item } : x)));
    else setBacklog((p) => [...p, { id: uid(), done: false, ...item }]);
    reset();
  };

  return (
    <section>
      <h2 className="font-serif text-lg text-stone-700 mb-1">Algum dia (sem data)</h2>
      <p className="text-xs text-stone-500 mb-3">Sem prazo. Pode ter restrição — ex.: lavar o carro só de dia.</p>
      <div className={`rounded-xl border p-3 space-y-2 shadow-sm ${editingId ? "bg-stone-100 border-stone-300" : "bg-white border-stone-200"}`}>
        {editingId && <div className="text-xs text-stone-600 font-medium">Editando</div>}
        <div className="flex gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Lavar o carro" className="flex-1 text-sm px-3 py-2 rounded-lg border border-stone-200 outline-none focus:border-stone-400" />
          <button onClick={save} className="px-4 bg-stone-700 text-white rounded-lg text-sm font-medium hover:bg-stone-800">{editingId ? "salvar" : "+"}</button>
          {editingId && <button onClick={reset} className="px-3 text-sm text-stone-500 rounded-lg hover:bg-stone-200">✕</button>}
        </div>
        <button onClick={() => setOpen((o) => !o)} className="text-xs text-stone-500 hover:underline">{open ? "ocultar restrição" : "+ restrição de horário / duração"}</button>
        {open && <ConstraintFields settings={settings} duration={duration} setDuration={setDuration} notBefore={notBefore} setNotBefore={setNotBefore} notAfter={notAfter} setNotAfter={setNotAfter} accent="bg-stone-600" />}
      </div>
      <div className="mt-3 space-y-2">
        {backlog.map((b) => (
          <div key={b.id} className="flex items-center gap-2 p-3 bg-white rounded-xl border border-stone-200">
            <div className="flex-1 min-w-0">
              <span className={`block text-sm ${b.done ? "line-through text-stone-400" : "text-stone-700"}`}>{b.title}</span>
              <span className="text-[10px] text-stone-400">{durLabel(b.duration || 30)}, {windowLabel(b.notBefore, b.notAfter)}</span>
            </div>
            <button onClick={() => startEdit(b)} className="text-stone-500 hover:bg-stone-100 text-sm px-2 rounded">editar</button>
            <button onClick={() => setBacklog((p) => p.filter((x) => x.id !== b.id))} className="text-stone-300 hover:text-red-500 text-sm px-2">remover</button>
          </div>
        ))}
      </div>
    </section>
  );
}
