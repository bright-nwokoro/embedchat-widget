import { Hono } from "hono";
import type { Env } from "../worker-configuration";
import { chatRoute } from "./routes/chat";
import { healthRoute } from "./routes/health";

const app = new Hono<{ Bindings: Env }>();

app.route("/chat", chatRoute);
app.route("/health", healthRoute);

app.all("*", (c) => c.json({ error: "not-found" }, 404));

export default app;
