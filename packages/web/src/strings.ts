import widget from "./i18n/en-US.json";
import type { DeepPartialStrings, Strings } from "./types.js";

export const DEFAULT_STRINGS: Strings = widget;

export function resolveStrings(s: DeepPartialStrings | undefined): Strings {
  const o = (s && typeof s === "object" ? s : {}) as DeepPartialStrings;
  return {
    ...DEFAULT_STRINGS,
    ...o,
    kinds: { ...DEFAULT_STRINGS.kinds, ...o.kinds },
    followUps: { ...o.followUps },
  } as Strings;
}
