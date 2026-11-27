// esbuild inlines only `version` from package.json, so the build carries no other metadata.
import { version } from "../package.json";

export const WEB_VERSION: string = version;
