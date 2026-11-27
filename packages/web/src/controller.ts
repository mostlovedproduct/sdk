// The lite entry: same client, minimal local checks (the server validates everything), smaller bundle.
import { createClient } from "@mostlovedproduct/core";
import type { ClientConfig, FollowUpHandle, ReportInput, SubmitFailure, SubmitResult, SubmitSuccess } from "@mostlovedproduct/core";
import { browserFamily, cleanApp, cleanContext, cleanFlags, cleanProps, cleanUser, clip, collectPage, splitText } from "./context.js";
import { resolveStrings } from "./strings.js";
import type {
  AppContext,
  ControllerConfig,
  Draft,
  FeedbackError,
  FeedbackState,
  FollowUpView,
  Flags,
  OpenOptions,
  Props,
  Strings,
  Subject,
  UserContext,
} from "./types.js";
import { WEB_VERSION } from "./version.js";

export type Listener = (state: FeedbackState) => void;

export interface FeedbackController {
  getState(): FeedbackState;
  /** Called on every state change. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void;
  open(options?: OpenOptions): void;
  close(): void;
  setField<K extends keyof Draft>(field: K, value: Draft[K]): void;
  /** Send the draft. Resolves (never rejects) when the submission and optional follow-up finish. */
  submit(): Promise<void>;
  answerFollowUp(value: { optionId: string } | { text: string }): Promise<void>;
  skipFollowUp(): Promise<void>;
  /** Discard the draft and any result; stays open if open. */
  reset(): void;
  /** Merge into `context`. */
  setContext(props: Props): void;
  /** Merge into `user` (`traits` merged too); `null` clears it. */
  setUser(user: UserContext | string | null): void;
  setFlags(flags: Flags): void;
  setApp(app: AppContext): void;
  readonly strings: Strings;
  readonly config: Readonly<ControllerConfig>;
  destroy(): void;
}

/** Call a customer hook; swallow anything it throws or rejects with. */
export function safe<A extends unknown[]>(fn: ((...a: A) => unknown) | undefined, ...args: A): void {
  if (typeof fn !== "function") return;
  try {
    const r = fn(...args) as { catch?: (f: () => void) => void } | undefined;
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch {
    /* a throwing hook must never break the widget or the host */
  }
}

function emptyDraft(): Draft {
  return { text: "" };
}

/**
 * Headless state machine over the core capture client:
 * idle → open → submitting → accepted → follow_up → done, with error keeping the draft for a retry.
 * Framework-free, DOM-free (page context is read only at submit time, when available).
 */
export function createFeedback(config: ControllerConfig): FeedbackController {
  const cfg = (config && typeof config === "object" ? config : {}) as ControllerConfig;
  const strings = resolveStrings(cfg.strings);
  const maxFollowUps = cfg.followUps ?? 1;

  const client = createClient({
    key: cfg.key,
    endpoint: cfg.endpoint,
    fallbackEndpoint: cfg.fallbackEndpoint,
    timeoutMs: cfg.timeoutMs,
    fetch: cfg.fetch,
    source: { kind: "human", surface: "web" },
    user: cleanUser(cfg.user),
    flags: cleanFlags(cfg.flags),
    app: cleanApp(cfg.app),
    context: cleanProps(cfg.context),
    // Separate providers: core caps each on its own, so a slow or throwing customer
    // getContext never costs the automatic page context (or anything else).
    getContext: [
      () => {
        const page = collectPage(cfg.page);
        return page && { page };
      },
      async () => (typeof cfg.getContext === "function" ? cleanContext(await cfg.getContext()) : undefined),
    ],
    // Core strips query + fragment from page.url / page.referrer unless opted in (contract section 5).
    keepUrl: typeof cfg.page === "object" && cfg.page ? { query: !!cfg.page.includeQuery, hash: !!cfg.page.includeHash } : false,
    beforeSend: cfg.beforeSend,
    redact: cfg.redact,
    followUps: maxFollowUps,
    dynamicFollowUps: true,
    onCaptured: acceptReceipt,
    onFollowUpPending: () => {
      if (state.status === "accepted") set({ followUpPending: true });
    },
    sdk: { name: "@mostlovedproduct/web", version: WEB_VERSION },
  } as ClientConfig);

  let state: FeedbackState = { status: "idle", draft: emptyDraft(), busy: false };
  let overrides: OpenOptions = {};
  let handle: FollowUpHandle | undefined;
  type DraftIdentity = { key: string; overrides: OpenOptions };
  type Submission = DraftIdentity & { captured: boolean; controller: AbortController };
  // Closing the UI leaves the send running. Its draft and context belong to that send.
  let submission: Submission | undefined;
  let destroyed = false;
  /** Resend handle for the last transient submit failure, valid while the draft is unchanged. */
  let pending: (DraftIdentity & { retry: NonNullable<SubmitFailure["retry"]> }) | undefined;
  const listeners = new Set<Listener>();

  function set(patch: Partial<FeedbackState>): void {
    if (destroyed) return;
    const next = { ...state, ...patch };
    for (const k of Object.keys(patch) as (keyof FeedbackState)[]) if (patch[k] === undefined) delete next[k];
    state = next;
    for (const listener of [...listeners]) {
      if (destroyed || state !== next) break;
      safe(listener, next);
    }
  }

  function fail(error: FeedbackError, status: FeedbackState["status"] = "error"): void {
    set({ status: state.status === "idle" ? "idle" : status, error });
    safe(cfg.onError, error);
  }

  function view(h: FollowUpHandle, index: number): FollowUpView {
    const s = strings.followUps[h.id] ?? {};
    const v: FollowUpView = { id: h.id, question: h.id === "open" ? h.question : s.question || h.question, input: h.input, index };
    if (h.options) v.options = h.options.map((o) => ({ id: o.id, label: s.options?.[o.id] || o.label }));
    const ph = s.placeholder || (h.input === "text" ? strings.answerPlaceholder : undefined);
    if (ph) v.placeholder = ph;
    return v;
  }

  /** What was filed, as far as a retry is concerned: same draft + same per-open overrides → same report. */
  const draftKey = (d: Draft): string => JSON.stringify([d.text, d.kind]);

  /** Back to a fresh draft. */
  function clear(status: FeedbackState["status"]): void {
    handle = undefined;
    pending = undefined;
    overrides = {};
    set({ status, draft: emptyDraft(), reportId: undefined, followUp: undefined, followUpPending: undefined, error: undefined, busy: false });
  }

  function finish(): void {
    handle = undefined;
    if (state.status === "idle") return clear("idle");
    set({ status: "done", followUp: undefined, followUpPending: undefined, busy: false, error: undefined });
  }

  function showFollowUp(h: FollowUpHandle | undefined, index: number, reportId: string): void {
    if (!h || index > maxFollowUps || state.status === "idle") return finish();
    handle = h;
    const v = view(h, index);
    set({ status: "follow_up", followUp: v, followUpPending: undefined, busy: false, error: undefined });
    if (!destroyed && handle === h) safe(cfg.onFollowUp, { action: "shown", id: v.id, question: v.question, reportId });
  }

  function acceptReceipt(receipt: Omit<SubmitSuccess, "followUp">) {
    if (destroyed || !submission || submission.captured) return;
    submission.captured = true;
    overrides = {};
    if (state.status === "idle") submission.controller.abort();
    set({
      status: state.status === "idle" ? "idle" : "accepted",
      reportId: receipt.reportId,
      draft: emptyDraft(),
      error: undefined,
    });
    safe(cfg.onSubmit, receipt);
  }

  async function submit(): Promise<void> {
    if (destroyed || submission || state.status === "follow_up" || state.status === "done") return;
    const d = state.draft;
    const text = d.text.trim();
    if (!text) return fail({ code: "invalid_input", message: strings.errorEmpty, retryable: false, field: "text", phase: "submit" });
    const { summary, details } = splitText(text);
    const input: ReportInput = { summary };
    if (details) input.details = details;
    if (d.kind) input.kind = d.kind;
    const subj = overrides.subject;
    if (subj) input.subject = (typeof subj === "string" ? { type: "feature", name: subj } : subj) as Subject;
    if (input.subject) input.subject = { ...input.subject, name: clip(String(input.subject.name), 200) };
    const ctx = cleanProps(overrides.context);
    if (ctx) input.context = ctx;
    const family = browserFamily();
    if (family) input.source = { client: { name: family } };

    // Unchanged since a send that timed out or failed in transit: resend the identical envelope
    // (same report id), so a send that did reach the server is not filed twice. Edited → new report.
    const attempt: Submission = { key: draftKey(d), overrides, captured: false, controller: new AbortController() };
    const resend = pending && pending.key === attempt.key && pending.overrides === attempt.overrides ? pending.retry : undefined;
    pending = undefined;

    submission = attempt;
    if (state.status !== "idle") set({ status: "submitting", error: undefined });
    let r: SubmitResult;
    try {
      const options = { signal: attempt.controller.signal };
      r = await (resend ? resend(options) : client.submit(input, options));
    } catch (e) {
      // core never rejects; belt and braces
      r = { ok: false, error: { code: "invalid_input", message: String(e), retryable: false } };
    }
    if (destroyed) return;
    if (!r.ok) {
      submission = undefined;
      if (r.retry) pending = { key: attempt.key, overrides: attempt.overrides, retry: r.retry };
      return fail({ ...r.error, phase: "submit" });
    }
    const { followUp, ...receipt } = r;
    acceptReceipt(receipt);
    submission = undefined;
    if (state.reportId !== r.reportId) return;
    if (state.status === "idle") return clear("idle");
    showFollowUp(followUp, 1, r.reportId);
  }

  async function respond(skip: boolean, value?: { optionId: string } | { text: string }): Promise<void> {
    const h = handle;
    const { followUp: q, reportId } = state;
    if (destroyed || !h || !q || !reportId || state.status !== "follow_up" || state.busy) return;
    if (!skip && value && "text" in value) {
      const t = String(value.text ?? "").trim();
      if (!t) return;
      value = { text: clip(t, 1000) };
    }
    set({ busy: true, error: undefined });
    if (destroyed || handle !== h) return;
    const r = skip ? await h.skip() : await h.answer(value!);
    if (destroyed || handle !== h) return;
    safe(cfg.onFollowUp, { action: skip ? "skipped" : "answered", id: q.id, question: q.question, reportId });
    if (destroyed || handle !== h) return;
    if (!r.ok) {
      const error: FeedbackError = { ...r.error, phase: "answer" };
      safe(cfg.onError, error);
      if (destroyed || handle !== h) return;
      // The report is already saved: a failed answer is not worth blocking on, unless it was our input.
      if (r.error.code === "invalid_input" && !skip) return set({ busy: false, error });
      return finish();
    }
    showFollowUp(r.followUp, q.index + 1, reportId);
  }

  const ctrl: FeedbackController = {
    strings,
    config: cfg,
    getState: () => state,
    subscribe(l) {
      if (typeof l !== "function") return () => {};
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    open(o = {}) {
      if (destroyed) return;
      const opts = (o && typeof o === "object" ? o : {}) as OpenOptions;
      const wasOpen = state.status !== "idle";
      if ("context" in opts || "subject" in opts) overrides = { context: opts.context, subject: opts.subject };
      const draft = { ...state.draft };
      if (opts.kind) draft.kind = opts.kind;
      if (opts.prefill && !draft.text.trim()) draft.text = String(opts.prefill);
      set({ status: wasOpen ? state.status : submission && !submission.captured ? "submitting" : state.error ? "error" : "open", draft });
      if (!wasOpen) safe(cfg.onOpen);
    },
    close() {
      if (destroyed || state.status === "idle") return;
      if (submission?.captured) submission.controller.abort();
      if (state.reportId) clear("idle");
      else set({ status: "idle" });
      safe(cfg.onClose);
    },
    setField(field, value) {
      if (destroyed) return;
      const draft = { ...state.draft, [field]: value };
      // Editing clears a validation/network error; the draft stays.
      if (state.status === "error") set({ draft, status: "open", error: undefined });
      else set({ draft });
    },
    submit,
    answerFollowUp: (v) => respond(false, v),
    skipFollowUp: () => respond(true),
    reset() {
      if (destroyed || submission) return;
      clear(state.status === "idle" ? "idle" : "open");
    },
    setContext: (p) => client.setContext(cleanProps(p) ?? {}),
    setUser: (u) => client.setUser(u === null ? null : (cleanUser(u) ?? {})),
    setFlags: (f) => client.setFlags(cleanFlags(f) ?? {}),
    setApp: (a) => client.setApp(cleanApp(a) ?? {}),
    destroy() {
      destroyed = true;
      if (submission?.captured) submission.controller.abort();
      listeners.clear();
      handle = undefined;
    },
  };
  return ctrl;
}
