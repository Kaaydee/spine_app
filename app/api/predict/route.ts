// src/app/api/predict/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import clientPromise from "@/lib/mongodb";

type Detection = {
  confidence?: number;
  score?: number;
  [key: string]: unknown;
};

export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();

  const file = formData.get("file") as File;
  const model = formData.get("model") as string;
  const threshold = formData.get("threshold") as string;

  if (!file) {
    return NextResponse.json({ message: "Missing file" }, { status: 400 });
  }

  const endpoint =
    model === "without_medclip"
      ? "/predict/without-medclip"
      : "/predict/with-medclip";

  const fastApiForm = new FormData();
  fastApiForm.append("file", file);
  const imageBuffer = Buffer.from(await file.arrayBuffer());
  const imageDataUrl = `data:${file.type || "image/png"};base64,${imageBuffer.toString("base64")}`;

  const response = await fetch(`${process.env.FASTAPI_URL}${endpoint}`, {
    method: "POST",
    body: fastApiForm,
  });

  if (!response.ok) {
    return NextResponse.json(
      { message: "Prediction service failed" },
      { status: response.status }
    );
  }

  const result = (await response.json()) as { detections?: Detection[] };

  const thresholdNumber = Number(threshold || 0.25);
  const detections = Array.isArray(result.detections) ? result.detections : [];

  const filteredDetections = detections.filter(
    (d) => Number(d.confidence ?? d.score ?? 0) >= thresholdNumber
  );

  const client = await clientPromise;
  const db = client.db();

  const saved = await db.collection("predictions").insertOne({
    userEmail: session.user.email,
    originalFileName: file.name,
    model,
    threshold: thresholdNumber,
    rawDetections: detections,
    editedDetections: filteredDetections,
    imageDataUrl,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return NextResponse.json({
    predictionId: saved.insertedId,
    model,
    threshold: thresholdNumber,
    detections: filteredDetections,
  });
}
