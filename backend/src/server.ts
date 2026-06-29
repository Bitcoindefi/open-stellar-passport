import mongoose from "mongoose";
import app from "./app";

const PORT = process.env.PORT || 3000;
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://localhost:27017/open_stellar_passport";

async function start() {
  await mongoose.connect(MONGO_URI);
  console.log("MongoDB connected");

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});