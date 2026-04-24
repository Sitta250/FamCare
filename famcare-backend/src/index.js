import "dotenv/config";
import express from "express";
import { validateSignature } from "@line/bot-sdk";
import { errorHandler } from "./middleware/errorHandler.js";
import apiRouter from "./routes/index.js";
import { handleLineWebhook } from "./webhook/handler.js";
import { startCronJobs } from "./jobs/cron.js";

const app = express();
const port = Number(process.env.PORT) || 3000;

// LINE verify pings / manual health checks — always 200
app.get("/webhook", (_req, res) => {
  res.status(200).json({ ok: true, service: "famcare-backend-webhook" });
});

// LINE webhook — must be before express.json() so we can parse raw body once.
// Verify requests may send empty events. We fast-ack those before signature checks.
// Real events must still pass signature validation.
if (process.env.LINE_CHANNEL_SECRET) {
  app.post(
    "/webhook",
    express.raw({ type: "*/*" }),
    (req, res, next) => {
      const rawBodyBuffer =
        Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? "");
      const rawBodyText = rawBodyBuffer.toString("utf8");

      let payload = {};
      if (rawBodyText.trim().length > 0) {
        try {
          payload = JSON.parse(rawBodyText);
        } catch (err) {
          console.warn(`[webhook] invalid JSON payload: ${err.message || err}`);
          return res.status(400).json({ error: "invalid json payload" });
        }
      }

      const events = Array.isArray(payload?.events) ? payload.events : [];
      if (events.length === 0) {
        return res.status(200).send();
      }

      const signature = req.get("x-line-signature");
      if (!signature) {
        console.warn("[webhook] missing x-line-signature for non-empty events");
        return res.status(401).json({ error: "missing signature" });
      }

      const isValid = validateSignature(
        rawBodyText,
        process.env.LINE_CHANNEL_SECRET,
        signature
      );
      if (!isValid) {
        console.warn("[webhook] invalid signature for non-empty events");
        return res.status(401).json({ error: "invalid signature" });
      }

      req.body = payload;
      return next();
    },
    handleLineWebhook
  );
} else {
  // Dev mode: no signature check
  app.post("/webhook", express.json(), handleLineWebhook);
}

app.use(express.json());

app.get("/", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "famcare-backend" });
});

app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "famcare-backend" });
});

app.use("/api/v1", apiRouter);

app.use(errorHandler);

app.listen(port, () => {
  console.log(`famcare-backend listening on :${port}`);
  startCronJobs();
});
