(() => {
  "use strict";

  const CFG = window.SUPPORTFLOW_CONFIG;
  if (!CFG || !CFG.API_BASE_URL || !CFG.ENDPOINTS) {
    console.error("SupportFlow config is missing. Check that config.js loads before app.js.");
    return;
  }
  const E = CFG.ENDPOINTS;
  const TOKEN_KEY = "supportflow_access_token";
  const $ = (id) => document.getElementById(id);
  const state = {
    token: sessionStorage.getItem(TOKEN_KEY),
    user: null,
    view: "overview",
    selectedTicketId: null,
    tickets: [],
    agents: [],
    lastAnalysis: null,
    chatTicketId: null,
    chatMessages: [],
    chatBusy: false
  };

  const NAV = {
    customer: [
      ["overview", "Overview", "⌂"],
      ["my-tickets", "My tickets", "▤"],
      ["create-ticket", "Create a ticket", "+"],
      ["resolveiq-chat", "ResolveIQ", "✳"],
      ["profile", "My profile", "☺"]
    ],
    agent: [
      ["overview", "Overview", "⌂"],
      ["assigned", "Assigned to me", "▣"],
      ["unassigned", "Unassigned queue", "⇢"]
    ],
    admin: [
      ["overview", "Overview", "⌂"],
      ["admin-tickets", "All tickets", "▤"],
      ["admin-users", "User management", "♙"],
      ["admin-analyses", "AI analyses", "✳"],
      ["profile", "My profile", "☺"]
    ]
  };

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  // Render a small, safe Markdown subset for AI answers. Escape HTML first so
  // model output can never inject markup or scripts into the workspace.
  function formatChatMessage(value, role) {
    const source = String(value ?? "");
    if (role !== "assistant") return esc(source).replace(/\n/g, "<br>");

    const inline = (line) => esc(line)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");

    const lines = source.split(/\r?\n/);
    const output = [];
    let listOpen = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      const bullet = /^(?:[-*•])\s+(.+)$/.exec(line);
      if (bullet) {
        if (!listOpen) { output.push("<ul>"); listOpen = true; }
        output.push(`<li>${inline(bullet[1])}</li>`);
        continue;
      }
      if (listOpen) { output.push("</ul>"); listOpen = false; }
      if (!line) {
        if (output.length && output[output.length - 1] !== "<br>") output.push("<br>");
      } else {
        output.push(inline(line));
        output.push("<br>");
      }
    }
    if (listOpen) output.push("</ul>");
    if (output[output.length - 1] === "<br>") output.pop();
    return output.join("");
  }

  function roleLabel(role) {
    return ({ admin: "Administrator", agent: "Support agent", customer: "Customer" })[role] || "User";
  }

  function dateLabel(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function priorityClass(value) {
    const priority = String(value || "").toLowerCase();
    return ["low", "medium", "high", "urgent"].includes(priority) ? `priority-${priority}` : "priority-unknown";
  }

  function statusClass(value) {
    return `status-${String(value || "open").toLowerCase().replace(/[^a-z_]/g, "")}`;
  }

  function toast(message, type = "info") {
    const region = $("toast-region");
    const item = document.createElement("div");
    item.className = `toast toast-${type}`;
    item.textContent = message;
    region.appendChild(item);
    requestAnimationFrame(() => item.classList.add("show"));
    window.setTimeout(() => {
      item.classList.remove("show");
      window.setTimeout(() => item.remove(), 220);
    }, 4200);
  }

  function setBusy(button, busy, label = "Working…") {
    if (!button) return;
    if (busy) {
      button.dataset.oldHtml = button.innerHTML;
      button.disabled = true;
      button.textContent = label;
    } else {
      button.disabled = false;
      if (button.dataset.oldHtml) {
        button.innerHTML = button.dataset.oldHtml;
        delete button.dataset.oldHtml;
      }
    }
  }

  function showBusy(show, label = "Working…") {
    $("busy-label").textContent = label;
    $("busy-overlay").hidden = !show;
  }

  function detailMessage(payload, fallback) {
    const detail = payload?.detail;
    if (Array.isArray(detail)) {
      return detail.map((item) => {
        const location = Array.isArray(item.loc) ? item.loc.join(" → ") : "Request";
        return `${location}: ${item.msg || "Invalid value"}`;
      }).join(" · ");
    }
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object") return JSON.stringify(detail);
    if (typeof payload?.message === "string") return payload.message;
    return fallback;
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const request = { ...options };
    const timeoutMs = Number(request.timeoutMs) || CFG.REQUEST_TIMEOUT_MS || 30000;
    delete request.auth;
    delete request.timeoutMs;
    if (request.body !== undefined && !(request.body instanceof FormData) && typeof request.body !== "string") {
      headers.set("Content-Type", "application/json");
      request.body = JSON.stringify(request.body);
    }
    if (state.token && options.auth !== false) headers.set("Authorization", `Bearer ${state.token}`);
    headers.set("Accept", "application/json");

    let response;
    async function doFetch() {
      return fetch(`${CFG.API_BASE_URL}${path}`, {
        ...request,
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      });
    }
    try {
      response = await doFetch();
    } catch (error) {
      // one quiet retry — helps when the API container just restarted
      try {
        await new Promise((r) => setTimeout(r, 700));
        response = await doFetch();
      } catch (error2) {
        setApiStatus(false, "API unavailable");
        if (error2.name === "TimeoutError" || error2.name === "AbortError") {
          throw new Error("ResolveIQ is taking longer than expected. Please try again in a moment.");
        }
        throw new Error(`Could not reach the API at ${CFG.API_BASE_URL}. Run: docker compose ps   and   docker compose logs api --tail 50`);
      }
    }

    // A 401/403/404 still proves that the server is reachable.
    setApiStatus(true, "API connected");
    const type = response.headers.get("content-type") || "";
    const payload = type.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const message = typeof payload === "object"
        ? detailMessage(payload, `Request failed (${response.status})`)
        : String(payload || `Request failed (${response.status})`);
      const error = new Error(`${message} (HTTP ${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function setApiStatus(online, label) {
    const el = $("api-status");
    el.classList.toggle("online", online);
    el.classList.toggle("offline", !online);
    el.querySelector("span").textContent = label;
  }

  async function checkApi() {
    try {
      await api(E.HEALTH, { auth: false });
      setApiStatus(true, "API connected");
    } catch {
      setApiStatus(false, "API unavailable");
    }
  }

  function showAuth(tab = "signin", message = "") {
    $("app-shell").hidden = true;
    $("auth-screen").hidden = false;
    switchAuthTab(tab);
    $("auth-error").textContent = message;
  }

  function switchAuthTab(tab) {
    const mode = ["signup","forgot","otp","reset"].includes(tab) ? tab : "signin";
    const signup = mode === "signup";
    if ($("signin-tab")) {
      $("signin-tab").classList.toggle("active", mode === "signin");
      $("signup-tab").classList.toggle("active", mode === "signup");
      $("signin-tab").setAttribute("aria-selected", String(mode === "signin"));
      $("signup-tab").setAttribute("aria-selected", String(mode === "signup"));
    }
    if ($("signin-form")) $("signin-form").hidden = mode !== "signin";
    if ($("signup-form")) $("signup-form").hidden = mode !== "signup";
    if ($("forgot-form")) $("forgot-form").hidden = mode !== "forgot";
    if ($("otp-form")) $("otp-form").hidden = mode !== "otp";
    if ($("reset-form")) $("reset-form").hidden = mode !== "reset";
    const titles = {
      signin: 'Welcome back<span class="accent-dot">.</span>',
      signup: 'Create your account<span class="accent-dot">.</span>',
      forgot: 'Reset your password<span class="accent-dot">.</span>',
      otp: 'Enter email code<span class="accent-dot">.</span>',
      reset: 'Choose a new password<span class="accent-dot">.</span>',
    };
    if ($("auth-title")) $("auth-title").innerHTML = titles[mode] || titles.signin;
    if ($("auth-error")) $("auth-error").textContent = "";
  }

  function renderShell() {
    const user = state.user;
    $("auth-screen").hidden = true;
    $("app-shell").hidden = false;
    $("user-name").textContent = user.name;
    $("user-role").textContent = roleLabel(user.role);
    $("user-avatar").textContent = (user.name || "U").trim().charAt(0).toUpperCase();
    $("topbar-name").textContent = user.name;
    $("topbar-avatar").textContent = (user.name || "U").trim().charAt(0).toUpperCase();
    $("main-nav").innerHTML = (NAV[user.role] || []).map(([view, label, icon]) => `
      <button class="nav-item ${state.view === view ? "active" : ""}" type="button" data-view="${view}">
        <span class="nav-icon">${icon}</span><span>${label}</span>
      </button>`).join("");
  }

  function setPage(title, html) {
    $("page-breadcrumb").textContent = title;
    $("page-content").innerHTML = html;
  }

  function pageHeader(kicker, title, subtitle, actions = "") {
    return `<div class="page-heading"><div><div class="eyebrow">${esc(kicker)}</div><h1>${title}</h1><p>${esc(subtitle)}</p></div><div class="heading-actions">${actions}</div></div>`;
  }

  function metric(label, value, foot, tone = "blue", symbol = "•") {
    return `<article class="metric-card"><div class="metric-top"><span>${esc(label)}</span><span class="metric-icon ${tone}">${symbol}</span></div><strong>${esc(value)}</strong><small>${esc(foot)}</small></article>`;
  }

  function emptyState(title, text) {
    return `<div class="empty-state"><div class="empty-icon">◇</div><strong>${esc(title)}</strong><p>${esc(text)}</p></div>`;
  }

  function ticketTable(rows, options = {}) {
    if (!rows.length) return emptyState(options.emptyTitle || "Nothing here yet", options.emptyText || "Tickets will appear here when they are available.");
    const showCustomer = options.showCustomer === true;
    const action = options.action || "open-ticket";
    return `<div class="table-scroll"><table class="data-table"><thead><tr><th>Ticket</th>${showCustomer ? "<th>Customer ID</th>" : ""}<th>Priority</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>
      ${rows.map((t) => `<tr>
        <td><button class="table-link" type="button" data-action="${action}" data-ticket-id="${t.id}"><span class="table-id">#${t.id}</span><strong>${esc(t.title)}</strong></button><small class="table-subtitle">${esc((t.description || "").slice(0, 84))}${(t.description || "").length > 84 ? "…" : ""}</small></td>
        ${showCustomer ? `<td>#${t.customer_id}</td>` : ""}
        <td><span class="priority-pill ${priorityClass(t.priority)}">${esc(t.priority)}</span></td>
        <td><span class="status-pill ${statusClass(t.status)}">${esc(String(t.status || "open").replaceAll("_", " "))}</span></td>
        <td>${esc(dateLabel(t.created_at))}</td>
        <td><button class="button button-small button-light" type="button" data-action="${action}" data-ticket-id="${t.id}">Open</button></td>
      </tr>`).join("")}
    </tbody></table></div>`;
  }

  function pageLoading(title = "Loading workspace") {
    setPage(title, `<div class="loading-panel"><span class="spinner"></span><strong>${esc(title)}…</strong></div>`);
  }

  async function navigate(view) {
    const allowed = (NAV[state.user.role] || []).some((item) => item[0] === view);
    if (!allowed && !view.startsWith("ticket-")) view = "overview";
    state.view = view;
    renderShell();
    await renderCurrentView();
  }

  async function renderCurrentView() {
    if (!state.user) return;
    if (state.view === "profile") return renderProfile();

    if (state.user.role === "customer") {
      if (state.view === "create-ticket") return renderCreateTicket();
      if (state.view === "ticket-detail") return renderCustomerTicket(state.selectedTicketId);
      if (state.view === "resolveiq-chat") return renderCustomerChat();
      return renderCustomerTickets();
    }
    if (state.user.role === "agent") {
      if (state.view === "assigned") return renderAgentQueue("assigned");
      if (state.view === "unassigned") return renderAgentQueue("unassigned");
      if (state.view === "ticket-detail") return renderAgentTicket(state.selectedTicketId);
      return renderAgentOverview();
    }
    if (state.user.role === "admin") {
      if (state.view === "admin-tickets") return renderAdminTickets();
      if (state.view === "admin-users") return renderAdminUsers();
      if (state.view === "admin-analyses") return renderAdminAnalyses();
      return renderAdminOverview();
    }
    showAuth("signin", "This account has an unsupported role. Contact your administrator.");
  }

  async function renderCustomerTickets() {
    pageLoading("Loading your tickets");
    try {
      const tickets = await api(E.CUSTOMER_TICKETS);
      state.tickets = Array.isArray(tickets) ? tickets : [];
      const open = state.tickets.filter((t) => !["resolved", "closed"].includes(t.status)).length;
      const resolved = state.tickets.length - open;
      setPage("My tickets", `
        ${pageHeader("CUSTOMER WORKSPACE", "Your support requests<span class=\"accent-dot\">.</span>", "Track updates and raise a new request whenever you need help.", '<button class="button button-primary" type="button" data-view="create-ticket">＋ Create ticket</button>')}
        <div class="metrics-grid">${metric("Total requests", state.tickets.length, "Tickets created by you", "blue", "▤")}${metric("Active requests", open, "Awaiting resolution", "orange", "◷")}${metric("Resolved / closed", resolved, "Completed requests", "green", "✓")}</div>
        <section class="panel"><div class="panel-heading"><div><div class="eyebrow">YOUR HISTORY</div><h2>Recent tickets</h2><p>Only your own support requests are shown here.</p></div><button class="button button-light button-small" data-action="refresh-view" type="button">Refresh ↻</button></div>${ticketTable(state.tickets, { emptyTitle: "No support requests yet", emptyText: "Create your first ticket and our team will take it from there." })}</section>
      `);
    } catch (error) { renderErrorPage("My tickets", error); }
  }

  function renderCustomerChatContent() {
    const ticket = state.tickets.find((item) => item.id === state.chatTicketId);
    if (!ticket) {
      setPage("ResolveIQ", `${pageHeader("CUSTOMER SUPPORT", 'ResolveIQ assistant<span class="accent-dot">.</span>', "Create a support ticket before starting a ticket-specific conversation.")}
        <section class="panel chat-empty"><div class="chat-empty-icon">✳</div><h2>No tickets to discuss yet</h2><p>Once you create a ticket, ResolveIQ can answer questions using its current details and the support knowledge base.</p><button class="button button-primary" type="button" data-view="create-ticket">Create a ticket →</button></section>`);
      return;
    }
    const ticketOptions = state.tickets.map((item) => `<option value="${item.id}" ${item.id === state.chatTicketId ? "selected" : ""}>#${item.id} · ${esc(item.title)}</option>`).join("");
    const messagesHtml = state.chatMessages.map((item) => `
      <article class="chat-message chat-${item.role}">
        <div class="chat-message-avatar">${item.role === "assistant" ? "✳" : esc((state.user?.name || "Y").trim().charAt(0).toUpperCase())}</div>
        <div class="chat-message-main">
          <div class="chat-message-meta"><strong>${item.role === "assistant" ? "ResolveIQ" : "You"}</strong><time>${item.role === "assistant" ? "AI assistant" : "You"}</time></div>
          <div class="chat-message-content">${formatChatMessage(item.content, item.role)}</div>
          ${item.sources?.length ? `<div class="chat-sources"><span>Knowledge sources</span>${item.sources.map((source) => `<span class="chat-source-chip">${esc(source)}</span>`).join("")}</div>` : ""}
        </div>
      </article>`).join("");
    const typingHtml = state.chatBusy ? `<article class="chat-message chat-assistant chat-typing"><div class="chat-message-avatar">✳</div><div class="chat-message-main"><div class="chat-message-meta"><strong>ResolveIQ</strong><time>Checking ticket and support guidance…</time></div><div class="typing-dots"><i></i><i></i><i></i></div></div></article>` : "";

    setPage("ResolveIQ", `${pageHeader("CUSTOMER SUPPORT", 'Talk to ResolveIQ<span class="accent-dot">.</span>', "Your AI support companion for ticket updates and support-policy questions.", '<button class="button button-light" type="button" data-view="my-tickets">My tickets</button>')}
      <div class="resolveiq-chat-layout">
        <aside class="panel chat-ticket-panel">
          <div class="chat-ticket-panel-top"><span class="eyebrow">TICKET CONTEXT</span><span class="chat-context-lock">Private to you</span></div>
          <label for="chat-ticket-select">Choose a support request</label>
          <select id="chat-ticket-select">${ticketOptions}</select>
          <div class="chat-ticket-summary">
            <div class="chat-ticket-number">SUPPORT REQUEST #${ticket.id}</div>
            <h3>${esc(ticket.title)}</h3>
            <div class="chat-ticket-badges"><span class="status-pill ${statusClass(ticket.status)}">${esc(String(ticket.status).replaceAll("_", " "))}</span><span class="priority-pill ${priorityClass(ticket.priority)}">${esc(ticket.priority)} priority</span></div>
            <p>${esc(ticket.description)}</p>
            <dl>
              <div><dt>Created</dt><dd>${esc(dateLabel(ticket.created_at))}</dd></div>
              <div><dt>Status</dt><dd>${esc(String(ticket.status).replaceAll("_", " "))}</dd></div>
              <div><dt>Assigned agent</dt><dd>${ticket.assigned_to ? `Agent #${ticket.assigned_to}` : "Not assigned yet"}</dd></div>
            </dl>
          </div>
          <div class="chat-context-note"><span>ⓘ</span><p>ResolveIQ can only access this account's ticket details and the support knowledge base.</p></div>
        </aside>

        <section class="panel resolveiq-chat-panel" aria-label="ResolveIQ conversation">
          <header class="chat-header">
            <div class="chat-header-avatar">✳</div>
            <div class="chat-header-copy"><strong>ResolveIQ</strong><small>SupportFlow AI · Ticket #${ticket.id}</small></div>
            <span class="chat-online"><i></i> Assistant</span>
          </header>
          <div class="chat-welcome-strip"><strong>How can I help?</strong><span>Ask about this ticket or relevant support policies.</span></div>
          <div class="chat-messages" id="chat-messages" aria-live="polite">${messagesHtml}${typingHtml}</div>
          <form id="resolveiq-chat-form" class="chat-compose">
            <div class="chat-compose-field"><textarea id="chat-message" name="message" rows="1" maxlength="2000" placeholder="Message ResolveIQ…" required ${state.chatBusy ? "disabled" : ""}></textarea><span class="chat-compose-hint">Avoid sharing passwords, OTPs or card details.</span></div>
            <button class="button button-primary chat-send-button" type="submit" ${state.chatBusy ? "disabled" : ""} aria-label="Send message">${state.chatBusy ? "…" : "➤"}</button>
          </form>
          <p class="chat-disclaimer">AI-generated guidance can be mistaken. Ticket status and policy details are based on available records; final decisions remain with the support team.</p>
        </section>
      </div>`);
    const messages = $("chat-messages");
    if (messages) messages.scrollTop = messages.scrollHeight;
    const input = $("chat-message");
    if (input && !state.chatBusy) input.focus({ preventScroll: true });
  }

  async function renderCustomerChat() {
    pageLoading("Loading ResolveIQ");
    try {
      const rows = await api(E.CUSTOMER_TICKETS);
      state.tickets = Array.isArray(rows) ? rows : [];
      const selected = state.tickets.find((item) => item.id === state.chatTicketId);
      if (!selected) {
        const newest = [...state.tickets].sort((a, b) => b.id - a.id)[0];
        state.chatTicketId = newest?.id ?? null;
        state.chatMessages = newest ? [{ role: "assistant", content: `Hi! I can help with your ticket #${newest.id}. Ask me about its status, priority, or the support policies relevant to your request.` }] : [];
      }
      renderCustomerChatContent();
    } catch (error) { renderErrorPage("ResolveIQ", error); }
  }

  async function sendCustomerChat(event) {
    event.preventDefault();
    const message = $("chat-message")?.value.trim();
    if (!message || !state.chatTicketId || state.chatBusy) return;
    const previousHistory = state.chatMessages.slice(-8).map(({ role, content }) => ({ role, content }));
    state.chatMessages.push({ role: "user", content: message });
    state.chatBusy = true;
    renderCustomerChatContent();
    try {
      const chatPath = typeof E.CUSTOMER_CHAT === "function"
        ? E.CUSTOMER_CHAT(state.chatTicketId)
        : `/tickets/${state.chatTicketId}/chat`;
      const response = await api(chatPath, {
        method: "POST",
        body: { message, history: previousHistory },
        timeoutMs: CFG.CHAT_TIMEOUT_MS || 90000
      });
      state.chatMessages.push({ role: "assistant", content: response.answer, sources: response.sources || [] });
    } catch (error) {
      state.chatMessages.push({ role: "assistant", content: `I could not answer that right now. ${error.message}` });
    } finally {
      state.chatBusy = false;
      renderCustomerChatContent();
    }
  }

  function renderCreateTicket() {
    setPage("Create a ticket", `
      ${pageHeader("CUSTOMER WORKSPACE", "How can we help<span class=\"accent-dot\">?</span>", "Describe the issue and our support team will review it.")}
      <section class="panel form-panel"><div class="panel-heading"><div><div class="eyebrow">NEW SUPPORT REQUEST</div><h2>Ticket details</h2><p>Provide enough information for a quick first review.</p></div></div>
        <form id="create-ticket-form" class="form-grid">
          <div class="field field-full"><label for="new-ticket-title">Subject</label><input id="new-ticket-title" name="title" maxlength="150" placeholder="e.g. Payment failed but money was deducted" required></div>
          <div class="field field-full"><label for="new-ticket-description">Description</label><textarea id="new-ticket-description" name="description" rows="6" placeholder="Tell us what happened, including any useful reference details. Never include passwords, OTPs, CVV, or full card details." required></textarea></div>
          <div class="field"><label for="new-ticket-priority">How urgent is this?</label><select id="new-ticket-priority" name="priority" required><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
          <div class="field field-actions"><span class="form-note">You can track the ticket from My tickets.</span><button class="button button-primary" type="submit">Submit ticket →</button></div>
        </form>
      </section>`);
  }


  function renderConversation(messages, ticketId, canReply) {
    const list = Array.isArray(messages) ? messages : [];
    const items = list.length
      ? list.map((m) => {
          const isAgent = m.sender_role === "agent" || m.sender_role === "system";
          const label = isAgent ? "Support" : "You";
          const sourceNote = m.source === "ai_approved" ? '<span class="msg-source">AI-assisted</span>' : "";
          return `<article class="ticket-msg ${isAgent ? "ticket-msg-agent" : "ticket-msg-customer"}">
            <div class="ticket-msg-meta"><strong>${label}</strong>${sourceNote}<time>${esc(dateLabel(m.created_at))}</time></div>
            <div class="ticket-msg-body">${formatChatMessage(m.body, isAgent ? "assistant" : "user")}</div>
          </article>`;
        }).join("")
      : `<div class="empty-inline"><p>No messages yet. When support replies, the conversation will show here.</p></div>`;
    const form = canReply
      ? `<form id="ticket-message-form" class="ticket-msg-form" data-ticket-id="${ticketId}">
           <label for="ticket-message-body">Your reply</label>
           <textarea id="ticket-message-body" name="body" rows="3" maxlength="4000" placeholder="Write a reply to support…" required></textarea>
           <div class="ticket-msg-form-actions">
             <button class="button button-primary" type="submit">Send reply</button>
           </div>
         </form>`
      : "";
    return `<section class="panel conversation-panel">
      <div class="panel-heading">
        <div>
          <div class="eyebrow">CONVERSATION</div>
          <h2>Ticket messages</h2>
          <p>Replies between you and support stay on this ticket.</p>
        </div>
        <span class="count-pill">${list.length}</span>
      </div>
      <div class="ticket-msg-list">${items}</div>
      ${form}
    </section>`;
  }

  async function renderCustomerTicket(ticketId, ticketData = null) {
    if (!ticketId) return navigate("my-tickets");
    pageLoading(`Loading ticket #${ticketId}`);
    try {
      const t = ticketData || await api(E.TICKET(ticketId));
      let messages = [];
      try {
        const rows = await api(E.TICKET_MESSAGES(ticketId));
        messages = Array.isArray(rows) ? rows : [];
      } catch (_) {
        messages = [];
      }
      // Fallback: older approved replies not yet in messages table
      let replies = [];
      try {
        const rows = await api(E.SUPPORT_REPLIES(ticketId));
        replies = Array.isArray(rows) ? rows : [];
      } catch (_) {
        replies = [];
      }
      if (!messages.length && replies.length) {
        messages = replies.map((r) => ({
          id: r.id,
          sender_role: "agent",
          body: r.reply,
          source: "ai_approved",
          created_at: r.approved_at,
        }));
      }
            setPage(`Ticket #${ticketId}`, `
        ${pageHeader("CUSTOMER WORKSPACE", `Ticket #${t.id}<span class="accent-dot">.</span>`, "Review your request, read support replies, and update details if needed.", '<button class="button button-light" data-view="my-tickets" type="button">← Back to tickets</button>')}
        <div class="detail-grid">
          <section class="panel detail-panel">
            <div class="panel-heading">
              <div>
                <div class="eyebrow">REQUEST DETAILS</div>
                <h2>${esc(t.title)}</h2>
                <p>Created ${esc(dateLabel(t.created_at))}</p>
              </div>
              <span class="status-pill ${statusClass(t.status)}">${esc(String(t.status).replaceAll("_", " "))}</span>
            </div>
            <div class="detail-body">
              <div class="detail-tags">
                <span class="priority-pill ${priorityClass(t.priority)}">${esc(t.priority)} priority</span>
                <span class="muted-tag">Customer #${t.customer_id}</span>
              </div>
              <p class="detail-description">${esc(t.description)}</p>
            </div>
          </section>
          <section class="panel form-panel">
            <div class="panel-heading">
              <div>
                <div class="eyebrow">EDIT REQUEST</div>
                <h2>Update ticket details</h2>
                <p>Changes are saved to your ticket.</p>
              </div>
            </div>
            <form id="edit-customer-ticket-form" class="form-grid" data-ticket-id="${t.id}">
              <div class="field field-full"><label for="edit-title">Subject</label><input id="edit-title" name="title" maxlength="150" value="${esc(t.title)}" required></div>
              <div class="field field-full"><label for="edit-description">Description</label><textarea id="edit-description" name="description" rows="6" required>${esc(t.description)}</textarea></div>
              <div class="field field-actions field-full"><button class="button button-primary" type="submit">Save changes</button></div>
            </form>
          </section>
        </div>
${renderConversation(messages, t.id, t.status !== "closed")}
      `);
    } catch (error) { renderErrorPage(`Ticket #${ticketId}`, error); }
  }

  async function renderAgentOverview() {
    pageLoading("Loading agent workspace");
    try {
      const [dashboard, assigned, unassigned] = await Promise.all([
        api(E.AGENT_DASHBOARD), api(E.ASSIGNED_TICKETS), api(E.UNASSIGNED_TICKETS)
      ]);
      const mine = Array.isArray(assigned) ? assigned : [];
      const queue = Array.isArray(unassigned) ? unassigned : [];
      state.tickets = mine;
      const active = mine.filter((t) => !["resolved", "closed"].includes(t.status)).length;
      const high = mine.filter((t) => ["high", "urgent"].includes(t.priority)).length;
      const aging = Array.isArray(dashboard?.aging_over_24h) ? dashboard.aging_over_24h : [];
      const agingHtml = aging.length
        ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Ticket</th><th>Priority</th><th>Status</th><th>Created</th></tr></thead><tbody>${aging.map((t) => `<tr><td><button class="linkish" type="button" data-action="open-ticket" data-ticket-id="${t.id}"><span class="table-id">#${t.id}</span> ${esc(t.title)}</button></td><td><span class="priority-pill ${priorityClass(t.priority)}">${esc(t.priority)}</span></td><td><span class="status-pill ${statusClass(t.status)}">${esc(String(t.status).replaceAll("_", " "))}</span></td><td>${esc(dateLabel(t.created_at))}</td></tr>`).join("")}</tbody></table></div>`
        : emptyState("No aging tickets", "Assigned tickets older than 24 hours will appear here.");
      setPage("Overview", `
        ${pageHeader("AGENT WORKSPACE", `Support queue<span class="accent-dot">.</span>`, "Claim work, track aging cases, and use ResolveIQ before you reply.", '<button class="button button-light" data-action="refresh-view" type="button">Refresh ↻</button>')}
        <div class="metrics-row">
          ${metric("Assigned to me", String(mine.length), "Total in your queue", "blue", "▣")}
          ${metric("Active", String(active), "Not resolved or closed", "violet", "●")}
          ${metric("High / urgent", String(high), "Needs faster attention", "green", "!")}
          ${metric("Unassigned pool", String(queue.length), "Available to claim", "blue", "+")}
        </div>
        <div class="detail-grid agent-detail-grid" style="margin-top:18px">
          <section class="panel">
            <div class="panel-heading"><div><div class="eyebrow">NEEDS ATTENTION</div><h2>Aging over 24 hours</h2><p>Open tickets on your desk that are older than a day.</p></div><span class="count-pill">${aging.length}</span></div>
            ${agingHtml}
          </section>
          <section class="panel">
            <div class="panel-heading"><div><div class="eyebrow">QUICK ACTIONS</div><h2>Jump in</h2><p>Open a queue or start with ResolveIQ on an assigned case.</p></div></div>
            <div class="workbench-body" style="display:grid;gap:10px;padding:8px 22px 22px">
              <button class="button button-primary" type="button" data-view="assigned">My assigned tickets →</button>
              <button class="button button-light" type="button" data-view="unassigned">Unassigned queue →</button>
            </div>
          </section>
        </div>
      `);
    } catch (error) { renderErrorPage("Overview", error); }
  }

  async function renderAgentQueue(kind) {
    const isAssigned = kind === "assigned";
    pageLoading(isAssigned ? "Loading assigned tickets" : "Loading unassigned tickets");
    try {
      const rows = await api(isAssigned ? E.ASSIGNED_TICKETS : E.UNASSIGNED_TICKETS);
      state.tickets = Array.isArray(rows) ? rows : [];
      setPage(isAssigned ? "Assigned tickets" : "Unassigned queue", `
        ${pageHeader(isAssigned ? "AGENT WORKSPACE" : "TEAM QUEUE", isAssigned ? "Assigned to me<span class=\"accent-dot\">.</span>" : "Available tickets<span class=\"accent-dot\">.</span>", isAssigned ? "Work currently assigned to your agent account." : "Claim a ticket to take ownership and begin working on it.", '<button class="button button-light" type="button" data-action="refresh-view">Refresh ↻</button>')}
        <section class="panel"><div class="panel-heading"><div><div class="eyebrow">${isAssigned ? "MY CASES" : "OPEN FOR CLAIM"}</div><h2>${rows.length} ticket${rows.length === 1 ? "" : "s"}</h2></div></div>${ticketTable(state.tickets, { emptyTitle: isAssigned ? "No assigned tickets" : "No available tickets", emptyText: isAssigned ? "Your assigned tickets will appear here." : "All tickets are currently assigned.", action: isAssigned ? "open-ticket" : "open-unassigned" })}</section>
      `);
    } catch (error) { renderErrorPage(isAssigned ? "Assigned tickets" : "Unassigned queue", error); }
  }

  async function renderAgentTicket(ticketId) {
    if (!ticketId) return navigate("assigned");
    pageLoading(`Loading ticket #${ticketId}`);
    try {
      const [ticket, analyses, messageRows] = await Promise.all([
        api(E.TICKET(ticketId)),
        api(E.TICKET_ANALYSES(ticketId)),
        api(E.TICKET_MESSAGES(ticketId)).catch(() => [])
      ]);
      const messages = Array.isArray(messageRows) ? messageRows : [];
      const history = Array.isArray(analyses) ? analyses : [];
      const transitions = { open: ["in_progress"], in_progress: ["resolved"], resolved: ["closed"], closed: [] };
      const next = transitions[ticket.status] || [];
      const analysisHtml = history.length
        ? history.map((a) => renderAgentAnalysis(a, ticket.id)).join("")
        : emptyState("No AI analysis yet", "Run ResolveIQ to retrieve company knowledge and generate a recommendation.");
      setPage(`Ticket #${ticketId}`, `
        ${pageHeader("AGENT WORKSPACE", `Ticket #${ticket.id}<span class="accent-dot">.</span>`, "Review the customer issue, manage its status and use ResolveIQ for a grounded recommendation.", '<button class="button button-light" data-view="assigned" type="button">← Back to queue</button>')}
        <div class="detail-grid agent-detail-grid">
          <section class="panel detail-panel">
            <div class="panel-heading">
              <div>
                <div class="eyebrow">CUSTOMER REQUEST</div>
                <h2>${esc(ticket.title)}</h2>
                <p>Customer #${ticket.customer_id} · Created ${esc(dateLabel(ticket.created_at))}</p>
              </div>
              <span class="status-pill ${statusClass(ticket.status)}">${esc(String(ticket.status).replaceAll("_", " "))}</span>
            </div>
            <div class="detail-body">
              <div class="detail-tags">
                <span class="priority-pill ${priorityClass(ticket.priority)}">${esc(ticket.priority)} priority</span>
                <span class="muted-tag">Assigned agent #${ticket.assigned_to ?? "—"}</span>
              </div>
              <p class="detail-description">${esc(ticket.description)}</p>
            </div>
            <div class="ticket-controls">
              <form id="ticket-status-form" class="inline-control" data-ticket-id="${ticket.id}">
                <label for="ticket-next-status">Move status</label>
                <div class="inline-control-row">
                  <select id="ticket-next-status" name="status" ${next.length ? "" : "disabled"}>
                    ${next.map((s) => `<option value="${s}">${s.replaceAll("_", " ")}</option>`).join("") || `<option value="">No next status</option>`}
                  </select>
                  <button class="button button-small button-primary" type="submit" ${next.length ? "" : "disabled"}>Update</button>
                </div>
              </form>
              <form id="ticket-priority-form" class="inline-control" data-ticket-id="${ticket.id}">
                <label for="ticket-new-priority">Update priority</label>
                <div class="inline-control-row">
                  <select id="ticket-new-priority" name="priority">
                    ${["low", "medium", "high", "urgent"].map((p) => `<option value="${p}" ${ticket.priority === p ? "selected" : ""}>${p}</option>`).join("")}
                  </select>
                  <button class="button button-small button-light" type="submit">Save</button>
                </div>
              </form>
            </div>
          </section>
          <section class="panel analyze-workbench">
            <div class="panel-heading">
              <div>
                <div class="eyebrow">AI WORKBENCH</div>
                <h2>ResolveIQ analysis</h2>
                <p>Retrieve relevant knowledge and prepare an agent recommendation.</p>
              </div>
              <span class="resolveiq-badge">✳ ResolveIQ</span>
            </div>
            <div class="workbench-body">
              <button class="button button-primary button-full" type="button" data-action="analyze-ticket" data-ticket-id="${ticket.id}">
                ✳ Analyze with ResolveIQ
              </button>
              <p class="form-note">AI output is a recommendation. Review it before approval or use.</p>
            </div>
          </section>
        </div>
        <section class="panel analysis-history-panel">
          <div class="panel-heading">
            <div>
              <div class="eyebrow">AI HISTORY</div>
              <h2>Previous analyses</h2>
              <p>Approve priority and customer reply separately after review.</p>
            </div>
            <span class="count-pill">${history.length} records</span>
          </div>
          <div class="analysis-list">${analysisHtml}</div>
        </section>
        ${renderConversation(messages, ticket.id, true)}
      `);
    } catch (error) { renderErrorPage(`Ticket #${ticketId}`, error); }
  }

  function renderAgentAnalysis(a, ticketId) {
    const priorityApproved = a.approved_by !== null && a.approved_by !== undefined;
    const replyApproved = a.reply_approved_at !== null && a.reply_approved_at !== undefined;
    const sources = Array.isArray(a.sources) ? a.sources : [];
    return `<article class="analysis-card">
      <div class="analysis-card-head">
        <div>
          <span class="analysis-id">ANALYSIS #${a.id}</span>
          <span class="muted-inline">${esc(dateLabel(a.created_at))}</span>
        </div>
        <div class="result-tags">
          <span class="tag">${esc(a.category)}</span>
          <span class="priority-pill ${priorityClass(a.suggested_priority)}">${esc(a.suggested_priority)}</span>
        </div>
      </div>
      <div class="analysis-content-grid">
        <div>
          <h3>Summary</h3>
          <p>${esc(a.summary)}</p>
        </div>
        <div>
          <h3>Suggested reply</h3>
          <textarea class="reply-editor" id="reply-${a.id}" rows="5">${esc(a.approved_reply || a.suggested_reply)}</textarea>
        </div>
      </div>
      <div class="source-row">
        <strong>Knowledge sources</strong>
        ${sources.length
          ? sources.map((s) => `<span class="source-chip">▧ ${esc(s)}</span>`).join("")
          : '<span class="muted-inline">No sources returned</span>'}
      </div>
      <div class="approval-row">
        <span class="approval-state ${priorityApproved ? "approved" : "pending"}">
          Priority: ${priorityApproved ? `Approved by #${a.approved_by}` : "Pending approval"}
        </span>
        <button class="button button-small ${priorityApproved ? "button-success" : "button-light"}" type="button"
          data-action="approve-priority" data-ticket-id="${ticketId}" data-analysis-id="${a.id}" ${priorityApproved ? "disabled" : ""}>
          ${priorityApproved ? "Priority approved" : "Approve priority"}
        </button>
        <span class="approval-state ${replyApproved ? "approved" : "pending"}">
          Reply: ${replyApproved ? "Approved" : "Pending approval"}
        </span>
        <button class="button button-small ${replyApproved ? "button-success" : "button-light"}" type="button"
          data-action="approve-reply" data-ticket-id="${ticketId}" data-analysis-id="${a.id}" ${replyApproved ? "disabled" : ""}>
          ${replyApproved ? "Reply approved" : "Approve edited reply"}
        </button>
      </div>
    </article>`;
  }


  async function renderProfile() {
    pageLoading("Loading profile");
    try {
      const me = await api(E.ME);
      state.user = me;
      const initial = (me.name || "U").charAt(0).toUpperCase();
      setPage("My profile", `
        ${pageHeader("ACCOUNT", `My profile<span class="accent-dot">.</span>`, "Your SupportFlow account details for this workspace.")}
        <section class="panel profile-panel">
          <div class="profile-hero">
            <div class="avatar avatar-large">${esc(initial)}</div>
            <div>
              <h2>${esc(me.name)}</h2>
              <p class="muted-inline">${esc(me.email)}</p>
              <span class="role-pill role-${esc(me.role)}">${esc(roleLabel(me.role))}</span>
            </div>
          </div>
          <div class="profile-grid">
            <div class="profile-field"><span>User ID</span><strong>#${me.id}</strong></div>
            <div class="profile-field"><span>Role</span><strong>${esc(roleLabel(me.role))}</strong></div>
            <div class="profile-field"><span>Email</span><strong>${esc(me.email)}</strong></div>
            <div class="profile-field"><span>Member since</span><strong>${esc(dateLabel(me.created_at))}</strong></div>
          </div>
          <p class="form-note" style="padding:0 22px 22px">
            Customers self-register. Agents and extra staff accounts are created by an administrator
            from <strong>User management</strong>, or with <code>python -m scripts.create_agent</code>.
          </p>
        </section>
      `);
    } catch (error) {
      renderErrorPage("My profile", error);
    }
  }

  async function renderAdminOverview() {
    pageLoading("Loading administrator overview");
    try {
      const dashboard = await api(E.ADMIN_DASHBOARD);
      const statusRows = Object.entries(dashboard.tickets_by_status || {});
      setPage("Overview", `
        ${pageHeader("ADMINISTRATOR WORKSPACE", `Workspace overview<span class="accent-dot">.</span>`, "Monitor support operations, users and ResolveIQ activity.", '<button class="button button-light" data-action="refresh-view" type="button">Refresh ↻</button>')}
        <div class="metrics-grid metrics-four">${metric("Total tickets", dashboard.total_tickets ?? 0, "Across all customers", "blue", "▤")}${metric("Unassigned", dashboard.unassigned_tickets ?? 0, "Waiting for an agent", "orange", "⇢")}${metric("Customers", dashboard.total_customers ?? 0, "Registered customer accounts", "green", "♙")}${metric("Agents", dashboard.total_agents ?? 0, `${dashboard.total_admins ?? 0} administrators`, "violet", "◎")}</div>
        <div class="metrics-grid metrics-two">${metric("Total users", dashboard.total_users ?? 0, "All workspace accounts", "blue", "♙")}${metric("AI analyses", dashboard.total_analyses ?? 0, "ResolveIQ analysis records", "violet", "✳")}</div>
        <section class="panel"><div class="panel-heading"><div><div class="eyebrow">OPERATIONS</div><h2>Tickets by status</h2><p>Current workflow distribution.</p></div><button class="button button-light button-small" data-view="admin-tickets" type="button">Manage tickets →</button></div><div class="status-breakdown">${statusRows.length ? statusRows.map(([status, count]) => `<div class="status-breakdown-item"><span class="status-pill ${statusClass(status)}">${esc(status.replaceAll("_", " "))}</span><strong>${count}</strong></div>`).join("") : emptyState("No ticket activity", "Ticket status metrics will appear here.")}</div></section>
      `);
    } catch (error) { renderErrorPage("Overview", error); }
  }

  async function renderAdminTickets() {
    pageLoading("Loading all tickets");
    try {
      const params = new URLSearchParams({ page: "1", limit: "100" });
      const [tickets, users] = await Promise.all([api(`${E.ADMIN_TICKETS}?${params}`), api(`${E.ADMIN_USERS}?page=1&limit=100&role=agent`)]);
      state.tickets = Array.isArray(tickets) ? tickets : [];
      state.agents = Array.isArray(users) ? users : [];
      const table = state.tickets.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Ticket</th><th>Customer</th><th>Priority</th><th>Status</th><th>Assigned to</th><th>Assign / reassign</th><th>Actions</th></tr></thead><tbody>${state.tickets.map((t) => `<tr><td><span class="table-id">#${t.id}</span><strong class="table-strong">${esc(t.title)}</strong><small class="table-subtitle">${esc((t.description || "").slice(0, 65))}</small></td><td><strong>${esc(t.customer_name || ("Customer #" + t.customer_id))}</strong><small class="table-subtitle">${esc(t.customer_email || "")}</small></td><td><span class="priority-pill ${priorityClass(t.priority)}">${esc(t.priority)}</span></td><td><span class="status-pill ${statusClass(t.status)}">${esc(String(t.status).replaceAll("_", " "))}</span></td><td>${t.assigned_to ? `<strong>${esc(t.agent_name || ("Agent #" + t.assigned_to))}</strong><small class="table-subtitle">${esc(t.agent_email || "")}</small>` : '<span class="text-warning">Unassigned</span>'}</td><td><div class="assign-cell"><select aria-label="Select agent for ticket ${t.id}" data-agent-select="${t.id}"><option value="">Choose agent</option>${state.agents.map((a) => `<option value="${a.id}" ${t.assigned_to === a.id ? "selected" : ""}>${esc(a.name)} (#${a.id})</option>`).join("")}</select><button class="button button-small button-light" type="button" data-action="admin-assign-ticket" data-ticket-id="${t.id}">Assign</button></div></td><td><button class="button button-small button-danger" type="button" data-action="admin-delete-ticket" data-ticket-id="${t.id}" data-ticket-title="${esc(t.title)}">Delete</button></td></tr>`).join("")}</tbody></table></div>` : emptyState("No tickets found", "Tickets created by customers will appear here.");
      setPage("All tickets", `${pageHeader("ADMINISTRATION", "Ticket management<span class=\"accent-dot\">.</span>", "Review, assign or permanently delete support tickets.", '<button class="button button-light" data-action="refresh-view" type="button">Refresh ↻</button>')}<section class="panel"><div class="panel-heading"><div><div class="eyebrow">GLOBAL TICKET QUEUE</div><h2>${state.tickets.length} tickets</h2><p>Deleting a ticket also deletes its conversation and AI analysis history.</p></div></div>${table}</section>`);
    } catch (error) { renderErrorPage("All tickets", error); }
  }

  async function renderAdminUsers() {
    pageLoading("Loading users");
    try {
      const users = await api(`${E.ADMIN_USERS}?page=1&limit=100`);
      const list = Array.isArray(users) ? users : [];
      const rows = list.map((u) => {
        const roleControl = u.role === "admin"
          ? '<span class="muted-inline">Protected administrator</span>'
          : `<div class="role-edit">
              <select data-role-select="${u.id}" aria-label="Role for ${esc(u.name)}">
                <option value="customer" ${u.role === "customer" ? "selected" : ""}>Customer</option>
                <option value="agent" ${u.role === "agent" ? "selected" : ""}>Agent</option>
              </select>
              <button class="button button-small button-light" type="button" data-action="admin-update-role" data-user-id="${u.id}">Save</button>
            </div>`;
        const deleteButton = u.role === "admin" ? "" :
          `<button class="button button-small button-danger" type="button" data-action="admin-delete-user" data-user-id="${u.id}">Delete</button>`;
        return `<tr>
          <td><div class="user-cell"><span class="avatar avatar-table">${esc((u.name || "U").charAt(0).toUpperCase())}</span><strong>${esc(u.name)}</strong></div></td>
          <td>${esc(u.email)}</td>
          <td><span class="role-pill role-${esc(u.role)}">${esc(roleLabel(u.role))}</span></td>
          <td>${esc(dateLabel(u.created_at))}</td>
          <td><div class="role-edit">${roleControl}${deleteButton}</div></td>
        </tr>`;
      }).join("");
      const table = list.length
        ? `<div class="table-scroll"><table class="data-table">
            <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
          </table></div>`
        : emptyState("No users found", "Registered accounts will appear here.");

      setPage("User management", `
        ${pageHeader("ADMINISTRATION", "People & access<span class=\"accent-dot\">.</span>", "Create customer or agent accounts and manage non-admin roles.", '<button class="button button-light" data-action="refresh-view" type="button">Refresh ↻</button>')}
        <div class="admin-user-grid">
          <section class="panel form-panel">
            <div class="panel-heading"><div><div class="eyebrow">PROVISION ACCOUNT</div><h2>Create a user</h2><p>New accounts can be customers or support agents.</p></div></div>
            <form id="admin-create-user-form" class="form-grid">
              <div class="field field-full"><label for="admin-user-name">Full name</label><input id="admin-user-name" name="name" maxlength="100" required></div>
              <div class="field field-full"><label for="admin-user-email">Email</label><input id="admin-user-email" name="email" type="email" required></div>
              <div class="field field-full"><label for="admin-user-password">Temporary password</label><input id="admin-user-password" name="password" type="password" minlength="8" maxlength="128" required></div>
              <div class="field field-full"><label for="admin-user-role">Role</label><select id="admin-user-role" name="role"><option value="agent">Support agent</option><option value="customer">Customer</option></select></div>
              <div class="field field-actions field-full"><button class="button button-primary" type="submit">Create account →</button></div>
            </form>
          </section>
          <section class="panel"><div class="panel-heading"><div><div class="eyebrow">WORKSPACE DIRECTORY</div><h2>${list.length} users</h2><p>Administrator accounts are protected from role changes here.</p></div></div>${table}</section>
        </div>`);
    } catch (error) {
      renderErrorPage("User management", error);
    }
  }

  async function renderAdminAnalyses() {
    pageLoading("Loading AI analyses");
    try {
      const analyses = await api(`${E.ADMIN_ANALYSES}?page=1&limit=100`);
      const list = Array.isArray(analyses) ? analyses : [];
      const html = list.length ? `<div class="analysis-list">${list.map((a) => `<article class="analysis-card"><div class="analysis-card-head"><div><span class="analysis-id">ANALYSIS #${a.id}</span><span class="muted-inline">Ticket #${a.ticket_id} · ${esc(dateLabel(a.created_at))}</span></div><div class="result-tags"><span class="tag">${esc(a.category)}</span><span class="priority-pill ${priorityClass(a.suggested_priority)}">${esc(a.suggested_priority)}</span></div></div><div class="analysis-content-grid"><div><h3>Summary</h3><p>${esc(a.summary)}</p></div><div><h3>Suggested reply</h3><p>${esc(a.approved_reply || a.suggested_reply)}</p></div></div><div class="source-row"><strong>Knowledge sources</strong>${(a.sources || []).length ? a.sources.map((s) => `<span class="source-chip">▧ ${esc(s)}</span>`).join("") : '<span class="muted-inline">No sources</span>'}</div><div class="approval-row"><span class="approval-state ${a.approved_by ? "approved" : "pending"}">Priority ${a.approved_by ? `approved by #${a.approved_by}` : "pending"}</span><span class="approval-state ${a.reply_approved_at ? "approved" : "pending"}">Reply ${a.reply_approved_at ? "approved" : "pending"}</span></div></article>`).join("")}</div>` : emptyState("No AI analyses yet", "ResolveIQ analyses created by agents will appear here.");
      setPage("AI analyses", `${pageHeader("RESOLVEIQ INTELLIGENCE", "AI analysis history<span class=\"accent-dot\">.</span>", "Review recommendations, source documents and agent approval activity.", '<button class="button button-light" data-action="refresh-view" type="button">Refresh ↻</button>')}<section class="panel"><div class="panel-heading"><div><div class="eyebrow">GLOBAL AUDIT VIEW</div><h2>${list.length} analysis records</h2><p>Recommendations are advisory and remain subject to agent review.</p></div></div>${html}</section>`);
    } catch (error) { renderErrorPage("AI analyses", error); }
  }

  function renderErrorPage(title, error) {
    setPage(title, `${pageHeader("WORKSPACE", "Something needs attention<span class=\"accent-dot\">.</span>", "The requested data could not be loaded.")}<section class="panel error-panel"><div class="error-icon">!</div><h2>Request failed</h2><p>${esc(error.message || "Unexpected error")}</p><button class="button button-primary" type="button" data-action="refresh-view">Try again</button></section>`);
  }

  async function refreshView() {
    await renderCurrentView();
  }


  async function requestPasswordReset(event) {
    event.preventDefault();
    const button = $("forgot-button");
    $("auth-error").textContent = "";
    setBusy(button, true, "Sending…");
    try {
      const email = $("forgot-email").value.trim();
      const result = await api(E.FORGOT_PASSWORD, {
        method: "POST",
        body: { email },
        auth: false,
      });
      $("otp-email").value = email;
      switchAuthTab("otp");
      $("auth-error").textContent = result.message || "If that account exists, a code was sent.";
      toast("If the account exists, enter the code from email / API logs.", "success");
    } catch (error) {
      $("auth-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  async function verifyResetOtp(event) {
    event.preventDefault();
    const button = $("otp-button");
    $("auth-error").textContent = "";
    setBusy(button, true, "Verifying…");
    try {
      const result = await api(E.VERIFY_RESET_OTP, {
        method: "POST",
        body: {
          email: $("otp-email").value.trim(),
          otp: $("otp-code").value.trim(),
        },
        auth: false,
      });
      $("reset-token").value = result.reset_token || "";
      switchAuthTab("reset");
      $("auth-error").textContent = result.message || "Code verified. Set a new password.";
    } catch (error) {
      $("auth-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  async function submitPasswordReset(event) {
    event.preventDefault();
    const button = $("reset-button");
    $("auth-error").textContent = "";
    const password = $("reset-password").value;
    const confirm = $("reset-password-confirm").value;
    if (password !== confirm) {
      $("auth-error").textContent = "Passwords do not match.";
      return;
    }
    const token = $("reset-token").value.trim();
    if (!token) {
      $("auth-error").textContent = "Missing reset session. Start forgot password again.";
      return;
    }
    setBusy(button, true, "Updating…");
    try {
      const result = await api(E.RESET_PASSWORD, {
        method: "POST",
        body: { token, new_password: password },
        auth: false,
      });
      toast(result.message || "Password updated.", "success");
      $("reset-form").reset();
      $("otp-form")?.reset();
      $("forgot-form")?.reset();
      if ($("signin-email")) $("signin-email").value = "";
      if ($("signin-password")) $("signin-password").value = "";
      switchAuthTab("signin");
      $("auth-error").textContent = "Password updated. Sign in with your new password.";
    } catch (error) {
      $("auth-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  async function signIn(event) {
    event.preventDefault();
    const button = $("signin-button");
    setBusy(button, true, "Signing in…");
    $("auth-error").textContent = "";
    try {
      const credentials = {
        email: $("signin-email").value.trim(),
        password: $("signin-password").value
      };
      const result = await api(E.LOGIN, { method: "POST", body: credentials, auth: false });
      if (!result.access_token) throw new Error("The login response did not include an access token.");
      state.token = result.access_token;
      sessionStorage.setItem(TOKEN_KEY, state.token);
      state.user = await api(E.ME);
      if (!NAV[state.user.role]) throw new Error(`Unsupported account role: ${state.user.role}`);
      state.view = "overview";
      renderShell();
      await renderCurrentView();
      toast(`Welcome, ${state.user.name}.`, "success");
    } catch (error) {
      state.token = null;
      state.user = null;
      sessionStorage.removeItem(TOKEN_KEY);
      $("auth-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
  }

  async function signUp(event) {
    event.preventDefault();
    const button = $("signup-button");
    setBusy(button, true, "Creating account…");
    $("auth-error").textContent = "";
    try {
      const credentials = {
        name: $("signup-name").value.trim(),
        email: $("signup-email").value.trim().toLowerCase(),
        password: $("signup-password").value
      };
      if (!credentials.name) throw new Error("Please enter your name.");
      if (credentials.password.length < 8) throw new Error("Password must be at least 8 characters.");

      await api(E.REGISTER, { method: "POST", body: credentials, auth: false });
      $("signup-form").reset();
      $("signin-email").value = credentials.email;
      $("signin-password").value = "";
      switchAuthTab("signin");
      $("auth-error").textContent = "Account created successfully. Sign in with your new password.";
      toast("Customer account created successfully.", "success");
    } catch (error) {
      $("auth-error").textContent = error.message || "Could not create account. Please try again.";
    } finally {
      setBusy(button, false);
    }
  }

  async function signOut() {
    state.token = null;
    state.user = null;
    state.tickets = [];
    sessionStorage.removeItem(TOKEN_KEY);
    if ($("signin-email")) $("signin-email").value = "";
    if ($("signin-password")) $("signin-password").value = "";
    if ($("signup-form")) $("signup-form").reset();
    if ($("forgot-form")) $("forgot-form").reset();
    if ($("otp-form")) $("otp-form").reset();
    if ($("reset-form")) $("reset-form").reset();
    showAuth("signin", "You have signed out.");
  }

  async function createTicket(event) {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const submit = form.querySelector("button[type=submit]");
    setBusy(submit, true, "Submitting…");
    try {
      const created = await api(E.CREATE_TICKET, {
        method: "POST",
        body: {
          title: $("new-ticket-title").value.trim(),
          description: $("new-ticket-description").value.trim(),
          priority: $("new-ticket-priority").value
        }
      });
      state.selectedTicketId = created.id;
      toast(`Ticket #${created.id} created successfully.`, "success");
      await navigate("ticket-detail");
    } catch (error) { toast(error.message, "error"); }
    finally { setBusy(submit, false); }
  }

  async function updateCustomerTicket(event) {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const id = form.dataset.ticketId;
    if (!id) {
      toast("Could not find ticket id for this form. Refresh and try again.", "error");
      return;
    }
    const titleEl = form.elements.namedItem("title");
    const descEl = form.elements.namedItem("description");
    if (!titleEl || !descEl) {
      toast("Ticket form fields are missing. Refresh the page.", "error");
      return;
    }
    const submit = form.querySelector("button[type=submit]");
    setBusy(submit, true, "Saving…");
    try {
      const updated = await api(E.UPDATE_TICKET(id), {
        method: "PATCH",
        body: {
          title: titleEl.value.trim(),
          description: descEl.value.trim()
        }
      });
      state.tickets = state.tickets.map((ticket) => ticket.id === Number(id) ? updated : ticket);
      toast("Ticket details saved successfully.", "success");
      await renderCustomerTicket(id, updated);
    } catch (error) { toast(error.message, "error"); }
    finally { setBusy(submit, false); }
  }

  async function updateTicketStatus(event) {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const id = form.dataset.ticketId;
    try {
      await api(E.UPDATE_STATUS(id), { method: "PATCH", body: { status: $("ticket-next-status").value } });
      toast("Ticket status updated.", "success");
      await renderAgentTicket(id);
    } catch (error) { toast(error.message, "error"); }
  }

  async function updateTicketPriority(event) {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const id = form.dataset.ticketId;
    try {
      await api(E.UPDATE_PRIORITY(id), { method: "PATCH", body: { priority: $("ticket-new-priority").value } });
      toast("Ticket priority updated.", "success");
      await renderAgentTicket(id);
    } catch (error) { toast(error.message, "error"); }
  }

  async function deleteAdminUser(userId) {
    if (!userId) return;
    const user = await api(`${E.ADMIN_USERS}?page=1&limit=100`).then((rows) => rows.find((row) => row.id === Number(userId))).catch(() => null);
    const name = user?.name || `user #${userId}`;
    const ok = window.confirm(
      `Permanently delete ${name}?\n\nTickets created by this account, their messages and AI analyses will also be deleted. Tickets assigned to this agent will be returned to the unassigned queue. Messages written by this user on other tickets will be removed. This cannot be undone.`
    );
    if (!ok) return;
    try {
      const result = await api(E.ADMIN_DELETE_USER(userId), { method: "DELETE" });
      toast(`Account deleted. ${result.deleted_tickets || 0} owned tickets and ${result.deleted_messages || 0} messages removed.`, "success");
      await renderAdminUsers();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function deleteAdminTicket(ticketId) {
    if (!ticketId) return;
    const row = state.tickets.find((ticket) => ticket.id === Number(ticketId));
    const title = row?.title ? `“${row.title}”` : `#${ticketId}`;
    const ok = window.confirm(
      `Permanently delete ticket ${title}?\n\nIts conversation messages and AI analysis history will also be deleted. This cannot be undone.`
    );
    if (!ok) return;
    try {
      const result = await api(E.ADMIN_DELETE_TICKET(ticketId), { method: "DELETE" });
      toast(`Ticket #${ticketId} deleted with ${result.deleted_messages || 0} messages and ${result.deleted_analyses || 0} AI analyses.`, "success");
      await renderAdminTickets();
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function createAdminUser(event) {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const submit = form.querySelector("button[type=submit]");
    setBusy(submit, true, "Creating…");
    try {
      await api(E.ADMIN_CREATE_USER, {
        method: "POST",
        body: {
          name: $("admin-user-name").value.trim(),
          email: $("admin-user-email").value.trim(),
          password: $("admin-user-password").value,
          role: $("admin-user-role").value
        }
      });
      toast(`Account created (${$("admin-user-role").value}). They can sign in with that email.`, "success");
      await renderAdminUsers();
    } catch (error) { toast(error.message, "error"); }
    finally { setBusy(submit, false); }
  }

  async function openTicket(id, unassigned = false) {
    state.selectedTicketId = Number(id);
    if (unassigned) {
      try {
        await api(E.CLAIM_TICKET(id), { method: "PATCH" });
        toast(`Ticket #${id} assigned to you.`, "success");
      } catch (error) {
        if (error.status !== 409) { toast(error.message, "error"); return; }
        toast("This ticket was already assigned. Refreshing the queue.", "warning");
        await renderAgentQueue("unassigned");
        return;
      }
    }
    await navigate("ticket-detail");
  }


  async function sendTicketMessage(event) {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const id = form.dataset.ticketId;
    const bodyEl = form.elements.namedItem("body");
    const body = bodyEl?.value?.trim();
    if (!id || !body) return toast("Write a message first.", "error");
    const submit = form.querySelector("button[type=submit]");
    setBusy(submit, true, "Sending…");
    try {
      await api(E.POST_TICKET_MESSAGE(id), { method: "POST", body: { body } });
      toast("Reply sent.", "success");
      if (state.user?.role === "customer") await renderCustomerTicket(id);
      else await renderAgentTicket(id);
    } catch (error) { toast(error.message, "error"); }
    finally { setBusy(submit, false); }
  }

  async function analyzeTicket(id) {
    const button = document.querySelector(`[data-action="analyze-ticket"][data-ticket-id="${id}"]`);
    setBusy(button, true, "ResolveIQ is analyzing…");
    try {
      const result = await api(E.ANALYZE_TICKET(id), { method: "POST" });
      state.lastAnalysis = result;
      toast("ResolveIQ analysis completed and saved.", "success");
      await renderAgentTicket(id);
    } catch (error) { toast(error.message, "error"); }
    finally { setBusy(button, false); }
  }

  async function approvePriority(ticketId, analysisId) {
    try {
      await api(E.APPROVE_PRIORITY(ticketId, analysisId), { method: "PATCH" });
      toast("AI-suggested priority approved and applied.", "success");
      await renderAgentTicket(ticketId);
    } catch (error) { toast(error.message, "error"); }
  }

  async function approveReply(ticketId, analysisId) {
    const textarea = $(`reply-${analysisId}`);
    const reply = textarea?.value.trim();
    if (!reply) return toast("The approved reply cannot be empty.", "error");
    try {
      await api(E.APPROVE_REPLY(ticketId, analysisId), { method: "PATCH", body: { approved_reply: reply } });
      toast("Reply approved — the customer can now see it on their ticket.", "success");
      await renderAgentTicket(ticketId);
    } catch (error) { toast(error.message, "error"); }
  }

  async function adminAssignTicket(ticketId) {
    const select = document.querySelector(`[data-agent-select="${ticketId}"]`);
    const agentId = Number(select?.value);
    if (!agentId) return toast("Choose an agent first.", "error");
    try {
      await api(E.ADMIN_ASSIGN_TICKET(ticketId), { method: "PATCH", body: { agent_id: agentId } });
      toast(`Ticket #${ticketId} assigned to agent #${agentId}.`, "success");
      await renderAdminTickets();
    } catch (error) { toast(error.message, "error"); }
  }

  async function adminUpdateRole(userId) {
    const select = document.querySelector(`[data-role-select="${userId}"]`);
    if (!select) return;
    try {
      await api(E.ADMIN_UPDATE_ROLE(userId), { method: "PATCH", body: { role: select.value } });
      toast("User role updated.", "success");
      await renderAdminUsers();
    } catch (error) { toast(error.message, "error"); }
  }

  function openResolveIQ() {
    if (!state.user) {
      showAuth("signin", "Please sign in to open your ResolveIQ workspace.");
      return;
    }

    const destinationByRole = {
      customer: "resolveiq-chat",
      agent: "assigned",
      admin: "admin-analyses"
    };

    const destination = destinationByRole[state.user.role];
    if (!destination) {
      toast("Your account does not have a ResolveIQ workspace.", "error");
      return;
    }

    return navigate(destination);
  }

  async function handleClick(event) {
    const origin = event.target instanceof Element ? event.target : null;
    const target = origin?.closest(
      "[data-view], [data-action], #logout-button, [data-auth-tab], [data-toggle-password], .assistant-card, .password-toggle"
    );
    if (!target) return;

    // The sidebar card is a div in index.html. It is wired as an interactive
    // control by setupResolveIQCard(), so it works without changing the markup.
    if (target.classList.contains("assistant-card") || target.dataset.action === "open-resolveiq") {
      return openResolveIQ();
    }

    if (target.id === "logout-button") return signOut();
    if (target.dataset.authTab) return switchAuthTab(target.dataset.authTab);
    if (target.dataset.togglePassword) {
      const input = $(target.dataset.togglePassword);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      target.textContent = show ? "🙈" : "👁";
      target.setAttribute("aria-label", show ? "Hide password" : "Show password");
      target.setAttribute("title", show ? "Hide password" : "Show password");
      target.setAttribute("aria-pressed", String(show));
      input.focus();
      return;
    }
    if (target.dataset.view) return navigate(target.dataset.view);

    const action = target.dataset.action;
    if (!action) return;

    if (action === "refresh-view") return refreshView();
    if (action === "open-ticket") return openTicket(target.dataset.ticketId, false);
    if (action === "open-unassigned") return openTicket(target.dataset.ticketId, true);
    if (action === "analyze-ticket") return analyzeTicket(target.dataset.ticketId);
    if (action === "approve-priority") return approvePriority(target.dataset.ticketId, target.dataset.analysisId);
    if (action === "approve-reply") return approveReply(target.dataset.ticketId, target.dataset.analysisId);
    if (action === "admin-assign-ticket") return adminAssignTicket(target.dataset.ticketId);
    if (action === "admin-update-role") return adminUpdateRole(target.dataset.userId);
    if (action === "admin-delete-user") return deleteAdminUser(target.dataset.userId);
    if (action === "admin-delete-ticket") return deleteAdminTicket(target.dataset.ticketId);
  }

  function handleChange(event) {
    if (event.target?.id !== "chat-ticket-select") return;
    state.chatTicketId = Number(event.target.value);
    const ticket = state.tickets.find((item) => item.id === state.chatTicketId);
    state.chatMessages = ticket ? [{ role: "assistant", content: `Hi! I can help with ticket #${ticket.id}. Ask me about its status, priority, or the support policies relevant to your request.` }] : [];
    renderCustomerChatContent();
  }

  function handleSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === "signin-form") return signIn(event);
    if (form.id === "signup-form") return signUp(event);
    if (form.id === "forgot-form") return requestPasswordReset(event);
    if (form.id === "otp-form") return verifyResetOtp(event);
    if (form.id === "reset-form") return submitPasswordReset(event);
    if (form.id === "create-ticket-form") return createTicket(event);
    if (form.id === "edit-customer-ticket-form") return updateCustomerTicket(event);
    if (form.id === "ticket-status-form") return updateTicketStatus(event);
    if (form.id === "ticket-priority-form") return updateTicketPriority(event);
    if (form.id === "admin-create-user-form") return createAdminUser(event);
    if (form.id === "resolveiq-chat-form") return sendCustomerChat(event);
    if (form.id === "ticket-message-form") return sendTicketMessage(event);
  }

  function setupResolveIQCard() {
    const card = document.querySelector(".assistant-card");
    if (!card) {
      console.warn("ResolveIQ sidebar card was not found in index.html.");
      return;
    }

    // Make the existing sidebar div clickable and keyboard accessible.
    card.dataset.action = "open-resolveiq";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", "Open ResolveIQ workspace");
    card.setAttribute("title", "Open your role-specific ResolveIQ workspace");
    card.style.cursor = "pointer";
  }

  async function boot() {
    setupResolveIQCard();

    // Support Enter and Space when the ResolveIQ sidebar card has keyboard focus.
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (!(event.target instanceof Element)) return;

      const card = event.target.closest(".assistant-card");
      if (!card) return;

      event.preventDefault();
      card.click();
    });

    // One delegated submit listener handles auth forms and dynamic workspace forms.
    // Do not attach duplicate listeners directly to sign-in or sign-up forms.
    document.addEventListener("submit", handleSubmit);
    document.addEventListener("click", handleClick);
    document.addEventListener("change", handleChange);
    document.addEventListener("keydown", (event) => {
      if (event.target?.id !== "chat-message" || event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      event.target.form?.requestSubmit();
    });

    await checkApi();

    if (!state.token) {
      showAuth();
      return;
    }

    try {
      state.user = await api(E.ME);
      if (!NAV[state.user.role]) throw new Error("Unsupported account role.");
      state.view = "overview";
      renderShell();
      await renderCurrentView();
    } catch (error) {
      state.token = null;
      state.user = null;
      sessionStorage.removeItem(TOKEN_KEY);
      showAuth("signin", error.message || "Please sign in again.");
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
