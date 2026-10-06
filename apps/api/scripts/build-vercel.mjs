// Bundles the API into one self-contained function and writes a ready-to-deploy folder: deploy/vercel-api/
//   npm run build:vercel -w @job-hunt-os/api   then   cd deploy/vercel-api && vercel deploy --prod
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../../deploy/vercel-api/", import.meta.url));
mkdirSync(join(root, "api"), { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL("../src/vercel.ts", import.meta.url))],
  outfile: join(root, "api/index.mjs"),
  bundle: true, platform: "node", format: "esm", target: "node24", minify: false, logLevel: "info",
  // optional native/auth add-ons of the MongoDB driver that we do not use
  external: ["kerberos", "@mongodb-js/zstd", "@aws-sdk/credential-providers", "gcp-metadata", "snappy", "socks", "aws4", "mongodb-client-encryption"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
writeFileSync(join(root, "package.json"), JSON.stringify({ name: "job-hunt-os-api", private: true, type: "module", engines: { node: "24.x" } }, null, 2));
writeFileSync(join(root, "index.mjs"), 'export { default } from "./api/index.mjs";\n');
writeFileSync(join(root, "vercel.json"), JSON.stringify({ rewrites: [{ source: "/(.*)", destination: "/api" }], functions: { "api/index.mjs": { maxDuration: 30 }, "index.mjs": { maxDuration: 30 } } }, null, 2));
console.log("Wrote", root);
