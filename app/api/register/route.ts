// src/app/api/register/route.ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import clientPromise from "@/lib/mongodb";

export async function POST(req: Request) {
  const { name, email, password } = await req.json();

  const client = await clientPromise;
  const db = client.db();

  const existed = await db.collection("users").findOne({ email });

  if (existed) {
    return NextResponse.json(
      { message: "Email already exists" },
      { status: 400 }
    );
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  await db.collection("users").insertOne({
    name,
    email,
    password: hashedPassword,
    createdAt: new Date(),
  });

  return NextResponse.json({ message: "Register success" });
}