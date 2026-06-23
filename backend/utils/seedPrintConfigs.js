import PrintConfiguration from "../Model/PrintConfiguration.js";
import { getDefaultPrintConfigDocuments } from "./printConfigDefaults.js";

export const seedDefaultPrintConfigs = async (cmp_id, { session } = {}) => {
  try {
    await PrintConfiguration.insertMany(
      getDefaultPrintConfigDocuments(cmp_id),
      { ordered: false, ...(session ? { session } : {}) },
    );

    if (process.env.NODE_ENV !== "test") {
      console.log(`Print configs seeded for cmp_id: ${cmp_id}`);
    }
  } catch (error) {
    if (error?.code === 11000) {
      return;
    }

    throw error;
  }
};
