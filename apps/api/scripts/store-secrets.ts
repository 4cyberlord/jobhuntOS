// Moves your sign-in into the database. Reads Email / password (and AGENT_API_KEY if you add it) from the repo's .env.local,
// (and GITHUB_TOKEN for private-repo updates), stores a salted password hash (and the agent key's SHA-256) in MongoDB, and never prints a secret.
//   npx tsx apps/api/scripts/store-secrets.ts
// Afterwards delete the plain-text password from .env.local: the server reads sign-in details from the database only.
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
config({ path: here("../.env") });                     // MONGODB_URI (the one secret that must stay outside the database)
const local = config({ path: here("../../../.env.local"), processEnv: {} }).parsed ?? {};
const pick = (...names: string[]) => { for (const n of names) { const hit = Object.keys(local).find((k) => k.toLowerCase() === n.toLowerCase()); if (hit && local[hit]) return local[hit]; } return undefined; };

const email = pick("OWNER_EMAIL", "Email");
const password = pick("OWNER_PASSWORD", "password");
const agentKey = pick("AGENT_API_KEY");
const githubToken = pick("GITHUB_TOKEN");
const githubRepo = pick("GITHUB_REPO") ?? "4cyberlord/jobhuntOS";
if (!process.env.MONGODB_URI) { console.error("MONGODB_URI not found in apps/api/.env"); process.exit(1); }
if (!email || !password) { console.error("Email / password not found in .env.local"); process.exit(1); }
if (password.length < 10) { console.error("The password in .env.local is shorter than 10 characters; choose a longer one first."); process.exit(1); }

const { hashPassword } = await import("../src/auth.js");
const { setOwner, setAgentKey, getOwner, setGithub } = await import("../src/repository.js");
await setOwner(email, hashPassword(password));
if (agentKey) await setAgentKey(agentKey);
if (githubToken) await setGithub(githubToken, githubRepo);
const stored = await getOwner();
console.log(`Owner saved in the database for ${stored?.email}.`);
console.log(githubToken ? `GitHub token saved in the database (repo ${githubRepo}); app updates will be served through the API.` : "No GITHUB_TOKEN in .env.local: add one to enable in-app updates from your private repo.");
console.log(agentKey ? "Agent key hash saved in the database." : "No AGENT_API_KEY in .env.local: the agent key is still read from the environment until you add one and re-run this.");
process.exit(0);
