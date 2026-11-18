/* CRM Nexcore - app de una sola página, sin build.
   Backend: Supabase (Auth + Postgres con RLS). Sin configuración => modo demo local. */
(function () {
  "use strict";

  // ---------------------------------------------------------------- utilidades
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$ " + Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });
  const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("es-AR") : "");
  const today = () => new Date().toISOString().slice(0, 10);
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  const STAGES = [
    { id: "nuevo", label: "Nuevo" },
    { id: "contactado", label: "Contactado" },
    { id: "propuesta", label: "Propuesta" },
    { id: "negociacion", label: "Negociación" },
    { id: "ganado", label: "Ganado" },
    { id: "perdido", label: "Perdido" },
  ];
  const stageLabel = (id) => (STAGES.find((s) => s.id === id) || {}).label || id;
  const ACT_TYPES = [
    { id: "llamada", label: "📞 Llamada" },
    { id: "reunion", label: "🤝 Reunión" },
    { id: "email", label: "✉️ Email" },
    { id: "tarea", label: "📌 Tarea" },
    { id: "nota", label: "📝 Nota" },
  ];
  const actLabel = (id) => (ACT_TYPES.find((s) => s.id === id) || {}).label || id;

  // ---------------------------------------------------------------- backend
  const cfg = window.CRM_CONFIG || {};
  const useSupabase = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);

  function supabaseBackend() {
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const ok = ({ data, error }) => {
      if (error) throw new Error(error.message);
      return data;
    };
    return {
      mode: "supabase",
      async getUser() {
        const { data } = await sb.auth.getSession();
        const u = data.session && data.session.user;
        if (!u) return null;
        const prof = await sb.from("profiles").select("role, full_name").eq("id", u.id).maybeSingle();
        return { id: u.id, email: u.email, role: (prof.data && prof.data.role) || "user" };
      },
      onAuthChange(cb) {
        sb.auth.onAuthStateChange((ev) => {
          if (ev === "SIGNED_IN" || ev === "SIGNED_OUT") cb();
        });
      },
      async signIn(email, password) {
        ok(await sb.auth.signInWithPassword({ email, password }));
      },
      async signUp(email, password, full_name) {
        const data = ok(
          await sb.auth.signUp({
            email,
            password,
            options: { data: { full_name }, emailRedirectTo: location.origin + location.pathname },
          })
        );
        return { needsConfirm: !data.session };
      },
      async signOut() {
        await sb.auth.signOut();
      },
      async list(table) {
        return ok(await sb.from(table).select("*").order("created_at", { ascending: false }));
      },
      async insert(table, row) {
        return ok(await sb.from(table).insert(row).select().single());
      },
      async update(table, id, row) {
        return ok(await sb.from(table).update(row).eq("id", id).select().single());
      },
      async remove(table, id) {
        ok(await sb.from(table).delete().eq("id", id));
      },
    };
  }

  // Modo demo: todo en localStorage, con usuarios separados (contraseña hasheada).
  function localBackend() {
    const K = "nexcore_crm_v1";
    const load = () => {
      try {
        return JSON.parse(localStorage.getItem(K)) || {};
      } catch {
        return {};
      }
    };
    const db = Object.assign({ users: [], session: null, companies: [], contacts: [], deals: [], activities: [] }, load());
    const save = () => localStorage.setItem(K, JSON.stringify(db));
    let listener = () => {};
    async function hash(s) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    const me = () => db.users.find((u) => u.id === db.session);
    const visible = (r) => {
      const u = me();
      return u && (r.owner_id === u.id || u.role === "admin");
    };
    return {
      mode: "local",
      async getUser() {
        const u = me();
        return u ? { id: u.id, email: u.email, role: u.role } : null;
      },
      onAuthChange(cb) {
        listener = cb;
      },
      async signIn(email, password) {
        const u = db.users.find((x) => x.email === email.toLowerCase());
        if (!u || u.pass !== (await hash(email.toLowerCase() + ":" + password))) throw new Error("Email o contraseña incorrectos");
        db.session = u.id;
        save();
        listener();
      },
      async signUp(email, password, full_name) {
        email = email.toLowerCase();
        if (db.users.some((x) => x.email === email)) throw new Error("Ese email ya está registrado");
        // El primer usuario del navegador queda como admin.
        const u = { id: uuid(), email, full_name, role: db.users.length ? "user" : "admin", pass: await hash(email + ":" + password) };
        db.users.push(u);
        db.session = u.id;
        save();
        listener();
        return { needsConfirm: false };
      },
      async signOut() {
        db.session = null;
        save();
        listener();
      },
      async list(table) {
        return db[table].filter(visible).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      },
      async insert(table, row) {
        const r = Object.assign({ id: uuid(), owner_id: db.session, created_at: new Date().toISOString() }, row);
        db[table].push(r);
        save();
        return r;
      },
      async update(table, id, row) {
        const r = db[table].find((x) => x.id === id && visible(x));
        if (!r) throw new Error("Sin permiso");
        Object.assign(r, row);
        save();
        return r;
      },
      async remove(table, id) {
        const i = db[table].findIndex((x) => x.id === id && visible(x));
        if (i < 0) throw new Error("Sin permiso");
        db[table].splice(i, 1);
        // simular "on delete set null"
        const refs = { companies: "company_id", contacts: "contact_id", deals: "deal_id" }[table];
        if (refs) ["contacts", "deals", "activities"].forEach((t) => db[t].forEach((x) => x[refs] === id && (x[refs] = null)));
        save();
      },
    };
  }

  const api = useSupabase ? supabaseBackend() : localBackend();

  // ---------------------------------------------------------------- estado
  const state = { user: null, data: { companies: [], contacts: [], deals: [], activities: [] }, view: "inicio", q: "" };
  const byId = (table, id) => state.data[table].find((x) => x.id === id);
  const contactName = (c) => (c ? [c.first_name, c.last_name].filter(Boolean).join(" ") : "");

  async function loadAll() {
    const [companies, contacts, deals, activities] = await Promise.all(["companies", "contacts", "deals", "activities"].map((t) => api.list(t)));
    state.data = { companies, contacts, deals, activities };
  }

  // ---------------------------------------------------------------- formularios
  const opts = (table, labelFn) => () => [{ v: "", l: "— ninguno —" }].concat(state.data[table].map((r) => ({ v: r.id, l: labelFn(r) })));
  const ENTITIES = {
    contacts: {
      title: "Contacto",
      fields: [
        { k: "first_name", l: "Nombre", req: true },
        { k: "last_name", l: "Apellido" },
        { k: "email", l: "Email", type: "email" },
        { k: "phone", l: "Teléfono" },
        { k: "position", l: "Cargo" },
        { k: "company_id", l: "Empresa", type: "select", options: opts("companies", (r) => r.name) },
        { k: "notes", l: "Notas", type: "textarea", full: true },
      ],
    },
    companies: {
      title: "Empresa",
      fields: [
        { k: "name", l: "Nombre", req: true, full: true },
        { k: "industry", l: "Rubro" },
        { k: "phone", l: "Teléfono" },
        { k: "website", l: "Sitio web", full: true },
        { k: "notes", l: "Notas", type: "textarea", full: true },
      ],
    },
    deals: {
      title: "Negocio",
      fields: [
        { k: "title", l: "Título", req: true, full: true },
        { k: "value", l: "Monto", type: "number" },
        { k: "stage", l: "Etapa", type: "select", options: () => STAGES.map((s) => ({ v: s.id, l: s.label })) },
        { k: "contact_id", l: "Contacto", type: "select", options: opts("contacts", contactName) },
        { k: "company_id", l: "Empresa", type: "select", options: opts("companies", (r) => r.name) },
        { k: "close_date", l: "Cierre estimado", type: "date" },
        { k: "notes", l: "Notas", type: "textarea", full: true },
      ],
    },
    activities: {
      title: "Actividad",
      fields: [
        { k: "subject", l: "Asunto", req: true, full: true },
        { k: "type", l: "Tipo", type: "select", options: () => ACT_TYPES.map((s) => ({ v: s.id, l: s.label })) },
        { k: "due_date", l: "Fecha", type: "date" },
        { k: "contact_id", l: "Contacto", type: "select", options: opts("contacts", contactName) },
        { k: "deal_id", l: "Negocio", type: "select", options: opts("deals", (r) => r.title) },
        { k: "done", l: "Completada", type: "checkbox" },
        { k: "notes", l: "Notas", type: "textarea", full: true },
      ],
    },
  };

  let modalCtx = null;
  function openForm(table, record, defaults) {
    const ent = ENTITIES[table];
    const r = record || defaults || {};
    modalCtx = { table, record };
    $("#modal-title").textContent = (record ? "Editar " : "Nuevo ") + ent.title.toLowerCase();
    $("#modal-fields").innerHTML = ent.fields
      .map((f) => {
        const v = r[f.k] ?? "";
        const cls = f.full ? ' class="full"' : "";
        const req = f.req ? " required" : "";
        if (f.type === "select") {
          const o = f.options().map((x) => `<option value="${esc(x.v)}"${x.v === v ? " selected" : ""}>${esc(x.l)}</option>`).join("");
          return `<label${cls}>${f.l}<select name="${f.k}">${o}</select></label>`;
        }
        if (f.type === "textarea") return `<label${cls}>${f.l}<textarea name="${f.k}">${esc(v)}</textarea></label>`;
        if (f.type === "checkbox") return `<label class="check${f.full ? " full" : ""}"><input type="checkbox" name="${f.k}"${v ? " checked" : ""}/> ${f.l}</label>`;
        return `<label${cls}>${f.l}<input name="${f.k}" type="${f.type || "text"}" value="${esc(v)}"${req}${f.type === "number" ? ' min="0" step="any"' : ""}/></label>`;
      })
      .join("");
    $("#modal-delete").classList.toggle("hidden", !record);
    $("#modal").showModal();
    const first = $("#modal-fields input, #modal-fields select");
    if (first) first.focus();
  }

  function readForm() {
    const ent = ENTITIES[modalCtx.table];
    const form = $("#modal-form");
    const row = {};
    ent.fields.forEach((f) => {
      const el = form.elements[f.k];
      if (f.type === "checkbox") row[f.k] = el.checked;
      else if (f.type === "number") row[f.k] = el.value === "" ? 0 : Number(el.value);
      else row[f.k] = el.value.trim() === "" ? null : el.value.trim();
    });
    return row;
  }

  $("#modal-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { table, record } = modalCtx;
    try {
      const row = readForm();
      if (record) await api.update(table, record.id, row);
      else await api.insert(table, row);
      $("#modal").close();
      toast("Guardado");
      await refresh();
    } catch (err) {
      toast("Error: " + err.message);
    }
  });
  $("#modal-cancel").addEventListener("click", () => $("#modal").close());
  $("#modal-delete").addEventListener("click", async () => {
    const { table, record } = modalCtx;
    if (!confirm("¿Eliminar este registro?")) return;
    try {
      await api.remove(table, record.id);
      $("#modal").close();
      toast("Eliminado");
      await refresh();
    } catch (err) {
      toast("Error: " + err.message);
    }
  });

  // ---------------------------------------------------------------- vistas
  const match = (...vals) => {
    const q = state.q.toLowerCase();
    return !q || vals.some((v) => String(v ?? "").toLowerCase().includes(q));
  };

  function table(headers, rows, tableName) {
    if (!rows.length) return `<div class="panel"><div class="empty">No hay registros todavía. Tocá “+ Nuevo” para crear uno.</div></div>`;
    return `<div class="panel"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows
      .map((r) => `<tr data-table="${tableName}" data-id="${r.id}">${r.cells.map((c) => `<td>${c}</td>`).join("")}</tr>`)
      .join("")}</tbody></table></div>`;
  }

  const VIEWS = {
    inicio: {
      title: "Inicio",
      newTable: "deals",
      render() {
        const d = state.data;
        const open = d.deals.filter((x) => !["ganado", "perdido"].includes(x.stage));
        const won = d.deals.filter((x) => x.stage === "ganado");
        const pending = d.activities.filter((a) => !a.done).sort((a, b) => (a.due_date || "9") < (b.due_date || "9") ? -1 : 1);
        const sum = (arr) => arr.reduce((s, x) => s + Number(x.value || 0), 0);
        const cards = [
          ["Contactos", d.contacts.length],
          ["Empresas", d.companies.length],
          ["Negocios abiertos", open.length],
          ["Pipeline abierto", money(sum(open))],
          ["Ganado", money(sum(won))],
          ["Tareas pendientes", pending.length],
        ];
        const t = today();
        return `
          <div class="cards">${cards.map(([l, v]) => `<div class="card"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("")}</div>
          <div class="grid-2">
            <div class="panel"><h3>Próximas actividades</h3>${
              pending.length
                ? `<table><tbody>${pending
                    .slice(0, 8)
                    .map((a) => `<tr data-table="activities" data-id="${a.id}"><td>${actLabel(a.type)}</td><td>${esc(a.subject)}</td><td>${
                      a.due_date ? `<span class="tag ${a.due_date < t ? "late" : ""}">${fmtDate(a.due_date)}</span>` : ""
                    }</td></tr>`)
                    .join("")}</tbody></table>`
                : `<div class="empty">Nada pendiente 🎉</div>`
            }</div>
            <div class="panel"><h3>Pipeline por etapa</h3><table><tbody>${STAGES.map((s) => {
              const ds = d.deals.filter((x) => x.stage === s.id);
              return `<tr onclick="location.hash='#/negocios'"><td>${s.label}</td><td>${ds.length}</td><td>${money(sum(ds))}</td></tr>`;
            }).join("")}</tbody></table></div>
          </div>`;
      },
    },
    negocios: {
      title: "Negocios",
      newTable: "deals",
      render() {
        const deals = state.data.deals.filter((x) => {
          const c = byId("contacts", x.contact_id);
          const co = byId("companies", x.company_id);
          return match(x.title, contactName(c), co && co.name, x.notes);
        });
        return `<p class="muted small">Arrastrá las tarjetas entre columnas para cambiar la etapa.</p><div class="kanban">${STAGES.map((s) => {
          const ds = deals.filter((x) => x.stage === s.id);
          return `<div class="column" data-stage="${s.id}">
            <div class="column-head"><span>${s.label}</span><span class="muted">${ds.length}</span></div>
            <div class="column-sum">${money(ds.reduce((a, x) => a + Number(x.value || 0), 0))}</div>
            ${ds
              .map((x) => {
                const c = byId("contacts", x.contact_id);
                const co = byId("companies", x.company_id);
                return `<div class="deal" draggable="true" data-table="deals" data-id="${x.id}">
                  <div class="t">${esc(x.title)}</div><div class="v">${money(x.value)}</div>
                  <div class="s">${esc([contactName(c), co && co.name].filter(Boolean).join(" · "))}</div>
                  ${x.close_date ? `<div class="s">Cierre: ${fmtDate(x.close_date)}</div>` : ""}
                </div>`;
              })
              .join("")}
          </div>`;
        }).join("")}</div>`;
      },
      after() {
        document.querySelectorAll(".deal").forEach((el) =>
          el.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", el.dataset.id))
        );
        document.querySelectorAll(".column").forEach((col) => {
          col.addEventListener("dragover", (e) => {
            e.preventDefault();
            col.classList.add("drag-over");
          });
          col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
          col.addEventListener("drop", async (e) => {
            e.preventDefault();
            col.classList.remove("drag-over");
            const id = e.dataTransfer.getData("text/plain");
            const deal = byId("deals", id);
            if (!deal || deal.stage === col.dataset.stage) return;
            try {
              await api.update("deals", id, { stage: col.dataset.stage });
              toast("Movido a " + stageLabel(col.dataset.stage));
              await refresh();
            } catch (err) {
              toast("Error: " + err.message);
            }
          });
        });
      },
    },
    contactos: {
      title: "Contactos",
      newTable: "contacts",
      render() {
        const rows = state.data.contacts
          .map((c) => ({ c, co: byId("companies", c.company_id) }))
          .filter(({ c, co }) => match(contactName(c), c.email, c.phone, c.position, co && co.name))
          .map(({ c, co }) => ({
            id: c.id,
            cells: [esc(contactName(c)), esc(c.email), esc(c.phone), esc(c.position), esc(co ? co.name : "")],
          }));
        return table(["Nombre", "Email", "Teléfono", "Cargo", "Empresa"], rows, "contacts");
      },
    },
    empresas: {
      title: "Empresas",
      newTable: "companies",
      render() {
        const rows = state.data.companies
          .filter((c) => match(c.name, c.industry, c.phone, c.website))
          .map((c) => ({
            id: c.id,
            cells: [
              esc(c.name),
              esc(c.industry),
              esc(c.phone),
              String(state.data.contacts.filter((x) => x.company_id === c.id).length),
              money(state.data.deals.filter((x) => x.company_id === c.id && x.stage !== "perdido").reduce((a, x) => a + Number(x.value || 0), 0)),
            ],
          }));
        return table(["Nombre", "Rubro", "Teléfono", "Contactos", "Negocios"], rows, "companies");
      },
    },
    actividades: {
      title: "Actividades",
      newTable: "activities",
      render() {
        const t = today();
        const rows = state.data.activities
          .slice()
          .sort((a, b) => (a.done - b.done) || ((a.due_date || "9") < (b.due_date || "9") ? -1 : 1))
          .filter((a) => {
            const c = byId("contacts", a.contact_id);
            const d = byId("deals", a.deal_id);
            return match(a.subject, a.type, contactName(c), d && d.title, a.notes);
          })
          .map((a) => {
            const c = byId("contacts", a.contact_id);
            const d = byId("deals", a.deal_id);
            const status = a.done
              ? `<span class="tag done">Hecha</span>`
              : a.due_date && a.due_date < t
              ? `<span class="tag late">Vencida</span>`
              : `<span class="tag">Pendiente</span>`;
            return { id: a.id, cells: [actLabel(a.type), esc(a.subject), fmtDate(a.due_date), esc(contactName(c)), esc(d ? d.title : ""), status] };
          });
        return table(["Tipo", "Asunto", "Fecha", "Contacto", "Negocio", "Estado"], rows, "activities");
      },
    },
  };

  function render() {
    const v = VIEWS[state.view] || VIEWS.inicio;
    $("#view-title").textContent = v.title;
    $("#search").classList.toggle("hidden", state.view === "inicio");
    document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === state.view));
    $("#view").innerHTML = v.render();
    if (v.after) v.after();
  }

  $("#view").addEventListener("click", (e) => {
    const el = e.target.closest("[data-table][data-id]");
    if (!el) return;
    const rec = byId(el.dataset.table, el.dataset.id);
    if (rec) openForm(el.dataset.table, rec);
  });
  $("#new-btn").addEventListener("click", () => {
    const v = VIEWS[state.view] || VIEWS.inicio;
    openForm(v.newTable, null, v.newTable === "deals" ? { stage: "nuevo" } : v.newTable === "activities" ? { type: "tarea", due_date: today() } : {});
  });
  $("#search").addEventListener("input", (e) => {
    state.q = e.target.value;
    render();
  });
  window.addEventListener("hashchange", () => {
    state.view = (location.hash.replace("#/", "") || "inicio").split("?")[0];
    state.q = "";
    $("#search").value = "";
    if (state.user) render();
  });

  async function refresh() {
    await loadAll();
    render();
  }

  // ---------------------------------------------------------------- login
  let signUpMode = false;
  function setAuthMode(up) {
    signUpMode = up;
    $("#name-field").classList.toggle("hidden", !up);
    $("#auth-submit").textContent = up ? "Crear cuenta" : "Ingresar";
    $("#auth-title").textContent = up ? "Crear cuenta" : "Ingresar";
    $("#auth-subtitle").textContent = up ? "Creá tu usuario" : "Ingresá con tu usuario";
    $("#auth-toggle").textContent = up ? "¿Ya tenés cuenta? Ingresá" : "¿No tenés cuenta? Registrate";
    $("#auth-msg").textContent = "";
  }
  $("#auth-toggle").addEventListener("click", (e) => {
    e.preventDefault();
    setAuthMode(!signUpMode);
  });
  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const msg = $("#auth-msg");
    msg.className = "auth-msg";
    msg.textContent = "Procesando...";
    try {
      if (signUpMode) {
        const r = await api.signUp(f.email.value.trim(), f.password.value, f.full_name.value.trim());
        if (r.needsConfirm) {
          msg.className = "auth-msg ok";
          msg.textContent = "Te enviamos un email para confirmar la cuenta. Confirmalo y después ingresá.";
          setAuthMode(false);
          return;
        }
      } else {
        await api.signIn(f.email.value.trim(), f.password.value);
      }
      msg.textContent = "";
      await boot();
    } catch (err) {
      msg.textContent = err.message === "Invalid login credentials" ? "Email o contraseña incorrectos" : err.message;
    }
  });
  $("#logout").addEventListener("click", async () => {
    await api.signOut();
    await boot();
  });

  async function boot() {
    state.user = await api.getUser();
    $("#demo-badge").classList.toggle("hidden", api.mode !== "local");
    if (!state.user) {
      $("#app-view").classList.add("hidden");
      $("#auth-view").classList.remove("hidden");
      if (signUpMode) setAuthMode(false);
      $("#auth-form").elements.password.value = "";
      return;
    }
    $("#auth-view").classList.add("hidden");
    $("#app-view").classList.remove("hidden");
    $("#user-email").textContent = state.user.email;
    $("#user-role").textContent = state.user.role === "admin" ? "Administrador (ve todo)" : "Usuario";
    state.view = (location.hash.replace("#/", "") || "inicio").split("?")[0];
    try {
      await refresh();
    } catch (err) {
      $("#view").innerHTML = `<div class="panel"><div class="empty">No se pudieron cargar los datos: ${esc(err.message)}<br/>¿Corriste el archivo supabase/schema.sql?</div></div>`;
    }
  }

  let booting = false;
  api.onAuthChange(async () => {
    if (booting) return;
    booting = true;
    try {
      await boot();
    } finally {
      booting = false;
    }
  });
  boot();
})();
