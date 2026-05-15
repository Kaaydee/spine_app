// src/lib/mongodb.ts
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI!;

if (!uri) {
  throw new Error("Missing MONGODB_URI");
}

let client: MongoClient;

const globalForMongo = global as typeof globalThis & {
  _mongoClientPromise?: Promise<MongoClient>;
};

if (!globalForMongo._mongoClientPromise) {
  client = new MongoClient(uri);
  globalForMongo._mongoClientPromise = client.connect();
}

const clientPromise = globalForMongo._mongoClientPromise;

export default clientPromise;
