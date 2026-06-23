import mongoose from "mongoose";

let isConnected = null;

const connectDB = async () => {
  if (process.env.NODE_ENV === "test") return;
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    throw new Error("❌ MONGO_URI is not defined in environment variables");
  }

  if (isConnected) {
    console.log("✅ Using existing MongoDB connection");
    return;
  }

  try {
    const connection = await mongoose.connect(MONGO_URI, {
      // useNewUrlParser: true,
      // useUnifiedTopology: true,
    });

    isConnected = connection.connections[0].readyState;
    console.log(`✅ MongoDB connected: ${connection.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
