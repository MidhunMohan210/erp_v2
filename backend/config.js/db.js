import mongoose from "mongoose";

let isConnected = null;

const connectDB = async () => {
  const isTestEnv = process.env.NODE_ENV === "test";

  const uri = isTestEnv
    ? process.env.MONGO_URI_TEST
    : process.env.MONGO_URI;

  if (!uri) {
    throw new Error("❌ Mongo URI is not defined in environment variables");
  }

  if (isConnected) {
    console.log("✅ Using existing MongoDB connection");
    return;
  }

  try {
    const connection = await mongoose.connect(uri, {});
    isConnected = connection.connections[0].readyState;
    console.log(`✅ MongoDB connected: ${connection.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
