import { NextResponse } from "next/server";
import { auth } from "@/auth";
import clientPromise from "@/lib/mongodb";

type PredictionDocument = {
  _id: { toString(): string };
  originalFileName?: string;
  model?: string;
  threshold?: number;
  editedDetections?: unknown[];
  createdAt?: Date;
  updatedAt?: Date;
};

export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const client = await clientPromise;
  const db = client.db();

  const predictions = (await db
    .collection("predictions")
    .find(
      { userEmail: session.user.email },
      {
        projection: {
          imageDataUrl: 0,
          rawDetections: 0,
          userEmail: 0,
        },
      }
    )
    .sort({ updatedAt: -1 })
    .limit(20)
    .toArray()) as PredictionDocument[];

  return NextResponse.json({
    predictions: predictions.map((prediction) => ({
      id: prediction._id.toString(),
      originalFileName: prediction.originalFileName ?? "Untitled image",
      model: prediction.model ?? "unknown",
      threshold: prediction.threshold ?? 0,
      detectionCount: prediction.editedDetections?.length ?? 0,
      createdAt: prediction.createdAt,
      updatedAt: prediction.updatedAt,
    })),
  });
}
