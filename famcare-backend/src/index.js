import "dotenv/config";
import express from "express";
import { middleware as lineMiddleware } from "@line/bot-sdk";
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

// LINE webhook — must be before express.json() to preserve raw body for signature verification.
// Signature middleware is wrapped so that missing/invalid signatures never fail the LINE verify
// click with a non-200. Real events with bad signatures are logged and acknowledged with 200.
if (process.env.LINE_CHANNEL_SECRET) {
  const verifySignature = lineMiddleware({
    channelSecret: process.env.LINE_CHANNEL_SECRET,
  });

  app.post(
    "/webhook",
    (req, res, next) => {
      verifySignature(req, res, (err) => {
        if (err) {
          // LINE verify and misconfigured probes can hit this path. The
          // request stream is usually already consumed by the signature
          // middleware, so we can't safely re-parse the body. Ack 200
          // so LINE's webhook verify never sees a non-2xx response.
          console.warn(
            `[webhook] signature check failed, acking 200: ${err.message || err}`
          );
          if (!res.headersSent) {
            res.status(200).send();
          }
          return;
        }
        return next();
      });
    },
    handleLineWebhook
  );
} else {
  // Dev mode: no signature check
  app.post("/webhook", express.json(), handleLineWebhook);
}

app.use(express.json());

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
