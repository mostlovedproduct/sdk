// ESM entry. Side-effect free and SSR-safe: nothing touches the DOM at import time.
export { init, createWidget, getWidget, type FeedbackWidget } from "./widget.js";
export { createFeedback, type FeedbackController, type Listener } from "./controller.js";
export { defineElement, ELEMENT_NAME, type FeedbackElement } from "./element.js";
export { DEFAULT_STRINGS } from "./strings.js";
export { splitText } from "./context.js";
export { WEB_VERSION } from "./version.js";
export type {
  AppContext,
  ClientError,
  ContextFields,
  ControllerConfig,
  DeepPartialStrings,
  Draft,
  FeedbackConfig,
  FeedbackError,
  FeedbackState,
  FeedbackStatus,
  Flags,
  FollowUpEvent,
  FollowUpId,
  FollowUpStrings,
  FollowUpView,
  Hooks,
  Kind,
  OpenOptions,
  PageOptions,
  Props,
  Report,
  Strings,
  Subject,
  Theme,
  TriggerOptions,
  TriggerPosition,
  UserContext,
} from "./types.js";
