// Cloudflare Worker entry: see issue.ts for what it does and issuer/README.md to deploy it.
import { handle, type IssuerEnv } from "./issue";

export default {
  fetch: (request: Request, env: IssuerEnv): Promise<Response> => handle(request, env),
};
