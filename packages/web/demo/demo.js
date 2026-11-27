// Host-page code for the demo. No inline scripts, so the page also runs under a strict CSP.

// 1. The documented queue stub: lets the page call mlp() before mlp.js has loaded.
window.mlp = window.mlp || function () { (mlp.q = mlp.q || []).push(arguments); };

var params = new URLSearchParams(location.search);
var DEMO_KEY = "mlp_pk_eyJrIjoiZGV2IiwiaiI6ImRlbW8iLCJ0IjoiYWNtZSIsInAiOiJ3ZWIifQ.ZGVtbw"; // format-valid, unsigned
var KEY = params.get("key") || DEMO_KEY;
var ENDPOINT = params.get("endpoint") || "http://localhost:8787";

// Fake app state the widget reads at submit time.
var cart = [];
var route = "/shop";

// 2. Init with context injection. Every call here is queued until mlp.js arrives.
mlp("init", {
  key: KEY,
  endpoint: ENDPOINT,
  followUps: 2,
  user: { id: "usr_8f3a2c", tier: "pro", traits: { seats: 4, signup: "2026-03" } },
  flags: { checkout_v2: true },
  getContext: function () {
    return {
      context: {
        route: route,
        cart_items: cart.length,
        cart_total: cart.reduce(function (s, p) { return s + p.price; }, 0),
        cart_skus: cart.map(function (p) { return p.sku; }),
      },
    };
  },
  beforeSend: function (report) {
    var pre = document.getElementById("payload");
    if (pre) pre.textContent = JSON.stringify(report, null, 2);
    return report;
  },
  onSubmit: function (r) { log("onSubmit " + r.reportId); },
  onFollowUp: function (e) { log("onFollowUp " + e.action + " " + e.id); },
  onError: function (e) { log("onError " + e.code + (e.field ? " (" + e.field + ")" : "")); },
  onOpen: function () { log("onOpen"); },
  onClose: function () { log("onClose"); },
});
mlp("setFlags", { pricing_page: "variant_b" }); // e.g. from your experiment SDK
mlp("setApp", { env: params.get("mock") ? "demo-mock" : "demo" });

function log(msg) {
  var el = document.getElementById("events");
  if (!el) return;
  var li = document.createElement("li");
  li.textContent = new Date().toLocaleTimeString() + "  " + msg;
  el.prepend(li);
  while (el.children.length > 8) el.lastChild.remove();
}

document.addEventListener("DOMContentLoaded", function () {
  // Cart
  var count = document.getElementById("cart-count");
  document.querySelectorAll("[data-add]").forEach(function (b) {
    b.addEventListener("click", function () {
      cart.push({ sku: b.dataset.add, price: Number(b.dataset.price) });
      count.textContent = String(cart.length);
      b.textContent = "Added";
      setTimeout(function () { b.textContent = "Add to cart"; }, 900);
    });
  });

  // Host dark mode: the widget follows the page background automatically.
  document.getElementById("theme-toggle").addEventListener("click", function () {
    var dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    this.setAttribute("aria-pressed", String(dark));
  });

  if (document.documentElement.hasAttribute("data-mock")) document.getElementById("mode").textContent = "mock mode (fetch stubbed)";
  else document.getElementById("mode").textContent = "live: " + ENDPOINT;

  // 3. Custom trigger: your own button, with a preselected kind.
  mlp("attach", "#report-bug", { kind: "broken", context: { area: "checkout" } });

  mlp("ready", function (widget) {
    // 4. A second, themed widget (independent instance, no floating button).
    var themed = mlp.createWidget({
      key: KEY,
      endpoint: ENDPOINT,
      trigger: false,
      kinds: ["idea", "missing", "praise"],
      badge: false,
      theme: {
        accent: "#8a4b22",
        accentContrast: "#fff",
        surface: "#fffaf3",
        text: "#2b1d12",
        muted: "#6b5646",
        border: "rgba(80,50,20,.18)",
        radius: "4px",
        fontFamily: "Georgia, 'Times New Roman', serif",
        scheme: "light",
      },
      strings: {
        title: "Tell the roasters",
        placeholder: "Which coffee should we roast next?",
        submit: "Send to the roastery",
        kinds: { praise: "Loved it" },
      },
      getContext: function () { return { context: { route: route, cart_items: cart.length } }; },
    });
    document.getElementById("open-themed").addEventListener("click", function (e) {
      themed.element.opener = e.currentTarget;
      themed.open({ subject: "Roast requests" });
    });

    // 5. Headless: the same controller with a fully custom inline UI.
    headless(mlp.createFeedback({ key: KEY, endpoint: ENDPOINT, followUps: 1, kinds: false }));
    window.demoWidget = widget;
  });
});

function headless(fb) {
  var root = document.getElementById("headless");
  var ta = root.querySelector("textarea");
  var send = root.querySelector("[data-send]");
  var status = root.querySelector("[data-status]");
  var q = root.querySelector("[data-question]");
  var opts = root.querySelector("[data-options]");
  var buttons = root.querySelectorAll("[data-helpful]");

  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      fb.open({ kind: b.dataset.helpful === "yes" ? "praise" : "confusing", subject: { type: "docs", name: "Brewing guide" } });
      root.dataset.open = "";
      ta.focus();
    });
  });
  ta.addEventListener("input", function () { fb.setField("text", ta.value); });
  send.addEventListener("click", function () { fb.submit(); });

  fb.subscribe(function (s) {
    send.disabled = s.status === "submitting";
    send.textContent = s.status === "submitting" ? "Sending…" : s.status === "error" ? "Retry" : "Send";
    if (ta.value !== s.draft.text) ta.value = s.draft.text;
    status.textContent =
      s.status === "error" ? s.error.message
      : s.status === "follow_up" ? "Saved. One quick question:"
      : s.status === "done" ? "Thanks! Saved as " + s.reportId.slice(0, 13) + "…"
      : "";
    q.textContent = s.followUp ? s.followUp.question : "";
    opts.replaceChildren();
    if (s.status === "follow_up" && s.followUp.options) {
      s.followUp.options.forEach(function (o) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "chip";
        b.textContent = o.label;
        b.addEventListener("click", function () { fb.answerFollowUp({ optionId: o.id }); });
        opts.append(b);
      });
      var skip = document.createElement("button");
      skip.type = "button";
      skip.className = "link";
      skip.textContent = "Skip";
      skip.addEventListener("click", function () { fb.skipFollowUp(); });
      opts.append(skip);
    }
    root.querySelector("[data-compose]").hidden = !(s.status === "open" || s.status === "submitting" || s.status === "error");
  });
}
