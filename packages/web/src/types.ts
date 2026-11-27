import type {
  AppContext,
  ClientError,
  ContextFields,
  Flags,
  FollowUpId,
  FollowUpInput,
  Kind,
  MaybePromise,
  Props,
  RedactConfig,
  Report,
  SubmitSuccess,
  UserContext,
} from "@mostlovedproduct/core";

export type { AppContext, ClientError, ContextFields, Flags, FollowUpId, Kind, Props, Report, UserContext };

/** `page: false` disables automatic page context. Query string and fragment are dropped unless opted in. */
export interface PageOptions {
  /** Keep `?query` in `page.url` (and a `page.referrer` you supply; the automatic referrer never keeps it). Default false. */
  includeQuery?: boolean;
  /** Keep `#fragment` (hash routers). Default false. */
  includeHash?: boolean;
}

export type Subject = { type: "tool" | "page" | "feature" | "docs" | "other"; name: string };

/** Per-open overrides. They apply to the report filed from this opening only. */
export interface OpenOptions {
  /** Preselect a kind. */
  kind?: Kind;
  /** Prefill the text (only if the draft is empty, so nothing typed is ever replaced). */
  prefill?: string;
  /** Merged over every other context source, for this report only. */
  context?: Props;
  /** What the feedback is about. A string is shorthand for `{ type: "feature", name }`. */
  subject?: Subject | string;
}

export interface FollowUpStrings {
  question?: string;
  /** Option labels by option id, e.g. `{ blocked: "It stopped me" }`. */
  options?: Record<string, string>;
  placeholder?: string;
}

export interface Strings {
  trigger: string;
  title: string;
  close: string;
  kindsLabel: string;
  kinds: Record<Kind, string>;
  textLabel: string;
  placeholder: string;
  submit: string;
  submitting: string;
  retry: string;
  saved: string;
  preparingFollowUp: string;
  answer: string;
  answerPlaceholder: string;
  skip: string;
  thanks: string;
  thanksDetail: string;
  done: string;
  errorEmpty: string;
  errorRateLimited: string;
  errorGeneric: string;
  badge: string;
  /** Data notice under the form. Links to your privacy policy and terms follow it when configured. */
  notice: string;
  privacy: string;
  terms: string;
  /** Localize follow-up questions by their stable id. */
  followUps: Partial<Record<FollowUpId, FollowUpStrings>>;
}

export type DeepPartialStrings = Partial<Omit<Strings, "kinds" | "followUps">> & {
  kinds?: Partial<Record<Kind, string>>;
  followUps?: Partial<Record<FollowUpId, FollowUpStrings>>;
};

export type TriggerPosition = "bottom-end" | "bottom-start" | "top-end" | "top-start" | "bottom-right" | "bottom-left" | "top-right" | "top-left";

export interface TriggerOptions {
  /** Corner. `*-end`/`*-start` follow text direction; `*-right`/`*-left` are aliases for them. Default "bottom-end". */
  position?: TriggerPosition;
  /** Visible label. Defaults to `strings.trigger`. */
  label?: string;
  /** `false` hides the icon; a string is SVG markup for a custom one. */
  icon?: boolean | string;
  /** Icon-only round button (label becomes the accessible name). */
  compact?: boolean;
}

export interface Theme {
  scheme?: "light" | "dark" | "auto";
  accent?: string;
  accentContrast?: string;
  surface?: string;
  text?: string;
  muted?: string;
  border?: string;
  success?: string;
  danger?: string;
  radius?: string;
  fontFamily?: string;
  fontSize?: string;
  shadow?: string;
  zIndex?: string | number;
  /** Base spacing unit, default 4px. Paddings and gaps are multiples of it. */
  space?: string;
  /** Distance of the trigger and panel from the viewport edge. Default 16px. */
  offset?: string;
}

export interface FollowUpView {
  id: FollowUpId;
  /** Localized question (strings.followUps[id].question, else the server's English text). */
  question: string;
  input: FollowUpInput;
  options?: { id: string; label: string }[];
  placeholder?: string;
  /** 1 or 2. */
  index: number;
}

export interface FollowUpEvent {
  action: "shown" | "answered" | "skipped";
  id: FollowUpId;
  question: string;
  reportId: string;
}

export type FeedbackStatus = "idle" | "open" | "submitting" | "accepted" | "follow_up" | "done" | "error";

export interface Draft {
  kind?: Kind;
  text: string;
}

export interface FeedbackError extends ClientError {
  /** Which step failed. Validation errors before sending use field "text". */
  phase: "submit" | "answer";
}

export interface FeedbackState {
  status: FeedbackStatus;
  draft: Draft;
  /** Set once the report is saved. */
  reportId?: string;
  /** The intake decision authorized preparing a generated follow-up. */
  followUpPending?: boolean;
  followUp?: FollowUpView;
  /** True while a follow-up answer is being sent. */
  busy: boolean;
  error?: FeedbackError;
}

export interface Hooks {
  onOpen?: () => void;
  onClose?: () => void;
  onSubmit?: (result: Omit<SubmitSuccess, "followUp">) => void;
  onFollowUp?: (event: FollowUpEvent) => void;
  onError?: (error: FeedbackError) => void;
}

/** Everything the headless controller needs. */
export interface ControllerConfig extends Hooks {
  /** Publishable capture key, `mlp_pk_…`. */
  key: string;
  endpoint?: string;
  fallbackEndpoint?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  user?: UserContext;
  flags?: Flags;
  app?: AppContext;
  context?: Props;
  /** Evaluated at submit time (current route, cart, plan…). Capped at 500 ms; throwing or a timeout drops only its result. */
  getContext?: () => MaybePromise<Partial<ContextFields> | null | undefined>;
  /** Automatic page context. Default on, without query string or fragment. */
  page?: boolean | PageOptions;
  beforeSend?: (report: Report) => MaybePromise<Report | null>;
  redact?: RedactConfig | false;
  /** Follow-up questions this UI may show. Default 1, max 2, 0 disables. */
  followUps?: 0 | 1 | 2;
  strings?: DeepPartialStrings;
}

export interface LegalOptions {
  /** Your privacy policy. */
  privacyUrl?: string;
  /** Your terms of service. */
  termsUrl?: string;
}

/** Full widget config for `init()`. */
export interface FeedbackConfig extends ControllerConfig {
  /** Floating button. `false` hides it (use `attach()` or `data-mlp-feedback`). */
  trigger?: boolean | TriggerOptions;
  /** Kinds offered as chips, in order. `false` hides the chips. Default all five. */
  kinds?: Kind[] | false;
  theme?: Theme;
  /** `lang` of the widget. Defaults to the host document's. */
  locale?: string;
  /**
   * Data notice under the form, linking to your own policies. Shown by default (without links);
   * `false` hides it. Only http(s) URLs are linked.
   */
  legal?: false | LegalOptions;
  /** "Feedback by Most Loved Product". Default true. */
  badge?: boolean;
  /** Close the thank-you panel automatically after this many ms. Default 0 (stay until closed). */
  autoCloseMs?: number;
  /** Nonce for the `<style>` fallback when constructable stylesheets are unavailable. */
  nonce?: string;
  /** `false` creates no UI at all (headless: use `instance.controller`). Default true. */
  ui?: boolean;
  /** Container for the element. Default document.body. */
  container?: Element;
}
