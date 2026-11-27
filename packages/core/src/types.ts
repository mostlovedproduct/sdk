import type { RedactPattern } from "./protocol/redact.js";
import type {
  AppContext,
  ErrorCode,
  Flags,
  FollowUpId,
  FollowUpInput,
  FollowUpOption,
  PageContext,
  Props,
  Report,
  SdkInfo,
  Source,
  UserContext,
} from "./protocol/types.js";

/** Customer-supplied context merged into every report. */
export interface ContextFields {
  user?: UserContext;
  flags?: Flags;
  app?: AppContext;
  page?: PageContext;
  context?: Props;
}

/** What callers pass to `submit()`: a Report whose `source` is optional (defaults come from config). */
export type ReportInput = Omit<Report, "source"> & { source?: Partial<Source> };

export interface RedactConfig {
  patterns?: Array<RegExp | RedactPattern>;
  emails?: boolean;
}

export type MaybePromise<T> = T | Promise<T>;

/** A `getContext` callback. */
export type ContextProvider = () => MaybePromise<Partial<ContextFields> | null | undefined>;

export interface ClientConfig {
  /** Origin-scoped publishable key for user feedback, or a secret key for MCP feedback. */
  key: string;
  /** Default https://in.mostlovedproduct.com */
  endpoint?: string;
  /** Select the capture API. Defaults to user-feedback. */
  capture?: "user-feedback" | "mcp-feedback";
  /** Second endpoint, tried once on network error, timeout or 5xx only. */
  fallbackEndpoint?: string;
  /** Total budget per call, ms. Default 4000. With a fallback, 1500 ms of it is reserved for the fallback. */
  timeoutMs?: number;
  /** Injectable fetch. Default globalThis.fetch. */
  fetch?: typeof fetch;
  /** Default source fields. Default { kind: "human", surface: "api" }. */
  source?: Partial<Source>;
  user?: UserContext;
  flags?: Flags;
  app?: AppContext;
  page?: PageContext;
  context?: Props;
  /**
   * Evaluated at submit time. One provider or several: each runs in parallel with its own
   * 500 ms cap, and later providers win on merge. A provider that throws, rejects or is too
   * slow contributes nothing; every other context source (static config, setters, other
   * providers, the report input) is still sent.
   */
  getContext?: ContextProvider | ContextProvider[];
  /**
   * `page.url` and `page.referrer` are sent without query string or fragment (contract section 5).
   * `true` keeps both parts; an object keeps the named parts only. Default false.
   */
  keepUrl?: boolean | { query?: boolean; hash?: boolean };
  /** Redaction before send. Default on (built-in patterns, emails off). `false` disables the client-side pass. */
  redact?: RedactConfig | false;
  /** Last look at the report. Return null to drop it. Throwing also drops it (fails closed). */
  beforeSend?: (report: Report) => MaybePromise<Report | null>;
  /** Max follow-ups this client can present. Omitted → server default (1). */
  followUps?: 0 | 1 | 2;
  /** Called as soon as the user-feedback receipt arrives, before any optional follow-up. */
  onCaptured?: (receipt: Omit<SubmitSuccess, "followUp">) => void;
  /** Called after capture when intake is preparing a generated follow-up. */
  onFollowUpPending?: () => void;
  /** Accept a generated text question on deployments that offer one. */
  dynamicFollowUps?: boolean;
  /** Lets wrappers identify themselves. Default { name: "@mostlovedproduct/core", version }. */
  sdk?: SdkInfo;
}

export type ClientErrorCode = ErrorCode | "network" | "timeout" | "dropped" | "invalid_input";

export interface ClientError {
  code: ClientErrorCode;
  message: string;
  retryable: boolean;
  field?: string;
  /** HTTP status, when a server answered. */
  status?: number;
  /** Seconds, from the server's `retry_after`. */
  retryAfter?: number;
}

export type AnswerValue = { optionId: string } | { text: string };

export interface FollowUpHandle {
  id: FollowUpId;
  question: string;
  input: FollowUpInput;
  options?: FollowUpOption[];
  expiresAt: string;
  /** Send the answer. Resolves like submit(); may carry a second follow-up. Never rejects. */
  answer(value: AnswerValue): Promise<SubmitResult>;
  /** Skip the question. Resolves like submit(). Never rejects. */
  skip(): Promise<SubmitResult>;
}

export interface SubmitSuccess {
  ok: true;
  reportId: string;
  duplicate: boolean;
  message: string;
  followUp?: FollowUpHandle;
}

export interface SubmitFailure {
  ok: false;
  error: ClientError;
  /**
   * Present when the failure may be transient (`network`, `timeout`, `unavailable`, `rate_limited`).
   * Resends the byte-identical body (same id, same `sent_at`, same context) with a fresh deadline,
   * without re-running getContext, beforeSend or redaction, so a send that actually reached the
   * server is recognised as a duplicate instead of becoming a second report. Never rejects.
   */
  retry?: (options?: RetryOptions) => Promise<SubmitResult>;
}

export interface RetryOptions {
  signal?: AbortSignal;
}

export type SubmitResult = SubmitSuccess | SubmitFailure;

export interface SubmitOptions {
  signal?: AbortSignal;
  followUps?: 0 | 1 | 2;
}

export interface Client {
  submit(report: ReportInput, options?: SubmitOptions): Promise<SubmitResult>;
  /** Merge into `context`. */
  setContext(props: Props): void;
  /** Merge into `user` (traits merged too); null clears the user entirely. */
  setUser(user: UserContext | null): void;
  /** Merge into `flags`. */
  setFlags(flags: Flags): void;
  /** Merge into `app`. */
  setApp(app: AppContext): void;
}
