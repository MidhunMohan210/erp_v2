import "./config.js/env.js";   
import app from "./app.js";
import connectDB from "./config.js/db.js";



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