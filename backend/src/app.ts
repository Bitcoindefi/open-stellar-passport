import express from "express";
import appealRoutes from "./routes/appeals";

const app = express();
app.use(express.json());

app.use(appealRoutes);

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok" }));

export default app;