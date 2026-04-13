import "dotenv/config";
import express from "express";
import { middleware as lineMiddleware } from "@line/bot-sdk";
import { errorHandler } from "./middleware/errorHandler.js";
import apiRouter from "./routes/index.js";
import { handleLineWebhook } from "./webhook/handler.js";
import { startCronJobs } from "./jobs/cron.js";

const app = express();
const port = Number(process.env.PORT) || 3000;

// LINE webhook — must be before express.json() to preserve raw body for signature verification
if (process.env.LINE_CHANNEL_SECRET) {
  app.post(
    "/webhook",
    lineMiddleware({ channelSecret: process.env.LINE_CHANNEL_SECRET }),
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
