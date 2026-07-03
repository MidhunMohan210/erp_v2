// utils/logs.js

/**
 * getApiLogs
 *
 * Simple helper to log incoming sync calls (for debugging / audit).
 *
 * Example usage:
 *   getApiLogs(cmp_id, "Account Groups Data");
 *
 * You can later replace console.log with a proper logger (Winston, Pino, etc.).
 */

export const getApiLogs = (cmp_id, label = "API Call") => {
  try {
    const timestamp = new Date().toISOString();

    if(process.env.NODE_ENV === "test") {
      return;
    }

    // Basic structured log
    console.log(
      JSON.stringify(
        {
          type: "SYNC_API",
          label,             // e.g. "Account Groups Data"
          cmp_id,             // company id
          timestamp,
        },
        null,
        2
      )
    );
  } catch (err) {
    if (process.env.NODE_ENV === "test") {
      return;
    }
    // Last-resort log if something goes wrong in logging itself
    console.error("Error in getApiLogs:", err?.message || err);
  }
};
