import dotenv from "dotenv";
import app from "./app.js";
import connectDB from "./config.js/db.js";

dotenv.config();

const PORT = process.env.PORT || 4000;

try {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`🚀 Server started at http://localhost:${PORT}`);
  });
} catch (err) {
  console.error("DB connection failed", err);
  process.exit(1);
}