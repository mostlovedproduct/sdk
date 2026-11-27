/** Wire contract types for capture protocol v1 (docs/contracts.md). */

export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

export const CAPTURE_PATHS = {
  userFeedback: "/api/v1/user-feedback",
  userFeedbackAnswers: "/api/v1/user-feedback/answers",
  mcpFeedback: "/api/v1/mcp-feedback",
} as const;

/** Every numeric limit of the wire contract. Lengths count Unicode code points; bytes are UTF-8. */
export const LIMITS = {
  /** Whole request body, UTF-8 bytes (32 KB). */
  bodyBytes: 32 * 1024,
  summaryMin: 1,
  summaryMax: 300,
  details: 4000,
  task: 500,
  expected: 1000,
  actual: 1000,
  suggestion: 1000,
  subjectName: 200,
  answerText: 1000,
  /** Props: max keys, key length, string value length, array items. */
  propsKeys: 32,
  propKey: 64,
  propString: 500,
  propArrayItems: 20,
  flagsKeys: 50,
  /** Not in the contract table: caps for otherwise-unbounded identifier-like strings. */
  shortString: 200,
  /** Not in the contract table: cap for page.url / page.referrer. */
  url: 2048,
  /** Not in the contract table: cap for contact.email (RFC 5321 path limit). */
  email: 254,
  /** Not in the contract table: cap for reply_token and option_id. */
  token: 256,
  maxFollowUps: 2,
  defaultFollowUps: 1,
  /** Reply token lifetime, seconds (30 min). */
  replyTokenTtlSeconds: 30 * 60,
  /** SDK total deadline, ms. */
  sdkTimeoutMs: 4000,
  /** SDK time reserved for the single fallback attempt, ms. */
  sdkFallbackReserveMs: 1500,
} as const;

export const KINDS = ["broken", "confusing", "missing", "idea", "praise"] as const;
export type Kind = (typeof KINDS)[number];

export const IMPACTS = ["blocked", "worked_around", "friction"] as const;
export type Impact = (typeof IMPACTS)[number];

export const SOURCE_KINDS = ["human", "agent"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SURFACES = ["web", "mcp", "cli", "api"] as const;
export type Surface = (typeof SURFACES)[number];

export const TRUST_LEVELS = ["authenticated", "known_host", "anonymous"] as const;
export type Trust = (typeof TRUST_LEVELS)[number];

export const SUBJECT_TYPES = ["tool", "page", "feature", "docs", "other"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const FOLLOW_UP_IDS = ["impact", "task", "expected", "kind", "use_case", "open"] as const;
export type FollowUpId = (typeof FOLLOW_UP_IDS)[number];

export type FollowUpInput = "choice" | "text";

/**
 * Input type of each follow-up, and for choice questions the valid option ids.
 * Option ids equal the enum values they set (kind → Kind, impact → Impact).
 */
export const FOLLOW_UP_INPUTS: Record<FollowUpId, readonly string[] | "text"> = {
  kind: KINDS,
  impact: IMPACTS,
  expected: "text",
  use_case: "text",
  task: "text",
  open: "text",
};

export type Props = Record<string, string | number | boolean | null | string[]>;

export interface Source {
  kind: SourceKind;
  surface: Surface;
  /** Browser family, or agent host/model as reported. */
  client?: { name: string; version?: string };
  /** sk keys only; otherwise set by server. */
  trust?: Trust;
  /** Agent filed because the user asked. */
  requested_by_user?: boolean;
}

export interface Subject {
  type: SubjectType;
  name: string;
}

export interface UserContext {
  /** The customer's own opaque ID. */
  id?: string;
  tier?: string;
  traits?: Props;
}

export type Flags = Record<string, string | boolean>;

export interface AppContext {
  version?: string;
  env?: string;
  release?: string;
}

export interface PageContext {
  url?: string;
  path?: string;
  title?: string;
  referrer?: string;
  locale?: string;
  viewport?: string;
}

export interface Contact {
  email?: string;
  notify_on_fix?: boolean;
}

export interface Report {
  source: Source;
  /** Optional for humans (classified later); required by the MCP tool. */
  kind?: Kind;
  impact?: Impact;
  /** 1–300 chars. One sentence. */
  summary: string;
  details?: string;
  task?: string;
  expected?: string;
  actual?: string;
  suggestion?: string;
  subject?: Subject;
  sentiment?: Sentiment;

  user?: UserContext;
  flags?: Flags;
  app?: AppContext;
  page?: PageContext;
  context?: Props;

  contact?: Contact;
}

export interface Answer {
  /** Must match the path. */
  report_id: string;
  follow_up_id: FollowUpId;
  reply_token: string;
  /** For input = "choice". */
  option_id?: string;
  /** ≤ 1000. */
  text?: string;
  skipped?: boolean;
}

export interface SdkInfo {
  name: string;
  version: string;
}

export interface EnvelopeOptions {
  /** Omitted defaults to one catalog follow-up. */
  follow_ups?: {
    /** Max follow-ups the client can present. */
    count: 0 | 1 | 2;
    /** The client can display and answer a generated text question. */
    dynamic: boolean;
  };
}

export interface Envelope {
  v: ProtocolVersion;
  /** UUIDv7, generated by the client before the first attempt. For type "report" it is the report ID. */
  id: string;
  type: "report" | "answer";
  /** ISO 8601, client clock (informational). */
  sent_at: string;
  sdk?: SdkInfo;
  report?: Report;
  answer?: Answer;
  options?: EnvelopeOptions;
}

export interface ReportEnvelope extends Envelope {
  type: "report";
  report: Report;
  answer?: undefined;
}

export interface AnswerEnvelope extends Envelope {
  type: "answer";
  answer: Answer;
  report?: undefined;
}

export interface FollowUpOption {
  id: string;
  label: string;
}

export interface FollowUp {
  id: FollowUpId;
  /** Catalog default or the generated question shown to the reporter. */
  question: string;
  input: FollowUpInput;
  options?: FollowUpOption[];
  /** Opaque; echo it back with the answer. */
  reply_token: string;
  expires_at: string;
}

export interface Receipt {
  report_id: string;
  status: "captured";
  /** True when this ID + fingerprint was already stored. */
  duplicate: boolean;
  follow_up?: FollowUp;
  message: string;
}

export const ERROR_CODES = [
  "invalid_payload",
  "unauthorized",
  "forbidden_origin",
  "conflict",
  "follow_up_expired",
  "payload_too_large",
  "rate_limited",
  "unavailable",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** HTTP status per error code. `unavailable` is any 5xx; 503 is the canonical one. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_payload: 400,
  unauthorized: 401,
  forbidden_origin: 403,
  conflict: 409,
  follow_up_expired: 410,
  payload_too_large: 413,
  rate_limited: 429,
  unavailable: 503,
};

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    field?: string;
    /** Seconds. */
    retry_after?: number;
  };
}
