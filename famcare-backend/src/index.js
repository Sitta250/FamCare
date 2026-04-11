import "dotenv/config";
import express from "express";
import { errorHandler } from "./middleware/errorHandler.js";
import apiRouter from "./routes/index.js";

const app = express();
const port = Number(process.env.PORT) || 3000;

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
});
