// src/app/api/predictions/[id]/annotations/route.ts
import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/auth";
import clientPromise from "@/lib/mongodb";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { editedDetections, imageDataUrl } = await req.json();
  const { id } = await params;

  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ message: "Invalid prediction id" }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db();

  const result = await db.collection("predictions").updateOne(
    {
      _id: new ObjectId(id),
      userEmail: session.user.email,
    },
    {
      $set: {
        editedDetections,
        ...(typeof imageDataUrl === "string" && imageDataUrl
          ? { imageDataUrl }
          : {}),
        updatedAt: new Date(),
      },
    }
  );

  if (result.matchedCount === 0) {
    return NextResponse.json(
      { message: "Prediction not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    message: "Saved",
    database: db.databaseName,
    collection: "predictions",
    predictionId: id,
  });
}
