import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/auth";
import clientPromise from "@/lib/mongodb";

type PredictionDocument = {
  _id: { toString(): string };
  originalFileName?: string;
  model?: string;
  threshold?: number;
  editedDetections?: unknown[];
  imageDataUrl?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ message: "Invalid prediction id" }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db();
  const prediction = (await db.collection("predictions").findOne({
    _id: new ObjectId(id),
    userEmail: session.user.email,
  })) as PredictionDocument | null;

  if (!prediction) {
    return NextResponse.json({ message: "Prediction not found" }, { status: 404 });
  }

  return NextResponse.json({
    prediction: {
      id: prediction._id.toString(),
      originalFileName: prediction.originalFileName ?? "Untitled image",
      model: prediction.model ?? "unknown",
      threshold: prediction.threshold ?? 0,
      detections: prediction.editedDetections ?? [],
      imageDataUrl: prediction.imageDataUrl ?? "",
      createdAt: prediction.createdAt,
      updatedAt: prediction.updatedAt,
    },
  });
}
