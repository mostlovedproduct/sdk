// ?mock=1 — stub fetch for the intake API so the whole flow works offline.
// Mirrors the contract's local follow-up selection (contracts.md 3.5) closely enough for a demo.
(function () {
  if (!/[?&]mock=1\b/.test(location.search)) return;
  var realFetch = window.fetch.bind(window);
  var asked = {};

  var KIND = {
    id: "kind",
    question: "What kind of feedback is this?",
    input: "choice",
    options: [
      { id: "broken", label: "Something's broken" },
      { id: "confusing", label: "It's confusing" },
      { id: "missing", label: "Something's missing" },
      { id: "idea", label: "I have an idea" },
      { id: "praise", label: "I love something" },
    ],
  };
  var IMPACT = {
    id: "impact",
    question: "How much did this get in your way?",
    input: "choice",
    options: [
      { id: "blocked", label: "It stopped me" },
      { id: "worked_around", label: "I found a workaround" },
      { id: "friction", label: "Minor annoyance" },
    ],
  };
  var EXPECTED = { id: "expected", question: "What did you expect to happen?", input: "text" };
  var USE_CASE = { id: "use_case", question: "What would this let you do?", input: "text" };
  var TASK = { id: "task", question: "What were you trying to do?", input: "text" };

  function pick(kind, r) {
    if (!kind) return KIND;
    if (kind === "broken" || kind === "confusing") {
      if (!r || !r.impact) return IMPACT;
    }
    if (kind === "broken" && r && !r.expected && (r.summary + (r.details || "")).length < 140) return EXPECTED;
    if ((kind === "missing" || kind === "idea") && r && !r.task && !r.details) return USE_CASE;
    if (kind === "confusing" && r && !r.task) return TASK;
    return null;
  }

  function fu(q) {
    return Object.assign({}, q, {
      reply_token: "demo_" + q.id,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
  }

  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : input.url;
    if (!/\/api\/v1\/user-feedback(?:\/answers)?$/.test(url) || !init || init.method !== "POST") return realFetch(input, init);
    var env = JSON.parse(init.body);
    console.info("[mock intake] %s", url, env);
    var body;
    if (env.type === "report") {
      var max = env.options?.follow_ups?.count ?? 1;
      var r = env.report;
      var q = max > 0 ? pick(r.kind, r) : null;
      asked[env.id] = { max: max, n: q ? 1 : 0, report: r };
      body = { report_id: env.id, status: "captured", duplicate: false, message: "Thanks, captured." };
      if (q) body.follow_up = fu(q);
    } else {
      var a = env.answer;
      var st = asked[a.report_id] || { max: 1, n: 1, report: {} };
      body = { report_id: a.report_id, status: "captured", duplicate: false, message: "Answer saved." };
      if (st.n < st.max && !a.skipped) {
        var rep = Object.assign({}, st.report);
        if (a.follow_up_id === "kind") rep.kind = a.option_id;
        if (a.follow_up_id === "impact") rep.impact = a.option_id;
        var next = a.follow_up_id === "kind" ? pick(rep.kind, rep) : null;
        if (next && next.id !== a.follow_up_id) {
          st.n++;
          body.follow_up = fu(next);
        }
      }
    }
    return new Promise(function (resolve) {
      setTimeout(function () {
        if (env.type === "report") {
          var offer = body.follow_up;
          delete body.follow_up;
          var stream = "event: captured\ndata: " + JSON.stringify(body) + "\n\n";
          if (offer) stream += "event: follow_up\ndata: " + JSON.stringify(offer) + "\n\n";
          resolve(new Response(stream, { status: 202, headers: { "Content-Type": "text/event-stream" } }));
        } else {
          resolve(new Response(JSON.stringify(body), { status: 202, headers: { "Content-Type": "application/json" } }));
        }
      }, 450);
    });
  };
  document.documentElement.setAttribute("data-mock", "");
})();
