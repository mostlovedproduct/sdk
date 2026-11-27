import { installLoader } from "./loader.js";

if (typeof window !== "undefined") {
  try {
    installLoader(window);
  } catch {
    /* never throw into the host page */
  }
}
