export { createClient, DEFAULT_ENDPOINT, GET_CONTEXT_TIMEOUT_MS } from "./client.js";
export { CORE_VERSION } from "./version.js";
export type {
  AnswerValue,
  Client,
  ClientConfig,
  ClientError,
  ClientErrorCode,
  ContextFields,
  ContextProvider,
  FollowUpHandle,
  MaybePromise,
  RedactConfig,
  ReportInput,
  RetryOptions,
  SubmitFailure,
  SubmitOptions,
  SubmitResult,
  SubmitSuccess,
} from "./types.js";
// Re-exported wire types so integrators need only one import.
export type {
  AppContext,
  Flags,
  FollowUpId,
  FollowUpInput,
  FollowUpOption,
  Impact,
  Kind,
  PageContext,
  Props,
  Report,
  SdkInfo,
  Source,
  UserContext,
} from "./protocol/types.js";
