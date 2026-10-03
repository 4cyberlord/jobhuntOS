import "dotenv/config";
import { buildApp } from "./app.js";

const app = await buildApp();
app.listen({ port: Number(process.env.API_PORT ?? 8787), host: process.env.API_HOST ?? "127.0.0.1" });
