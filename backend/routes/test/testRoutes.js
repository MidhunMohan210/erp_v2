import express from "express";
import mongoose from "mongoose";

const router = express.Router();

// DELETE /api/test/reset-all
router.delete("/reset-all", async (req, res) => {
  if (process.env.NODE_ENV !== "test") {
    return res.status(403).json({ message: "Not allowed in this environment" });
  }

  try {
    const collections = mongoose.connection.collections;

    const promises = Object.values(collections).map((collection) =>
      collection.deleteMany({})
    );

    await Promise.all(promises);

    return res.json({ message: "All test collections cleared" });
  } catch (err) {
    console.error("Error resetting test database", err);
    return res.status(500).json({ message: "Failed to reset test database" });
  }
});

export default router;
