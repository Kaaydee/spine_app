// src/auth.ts
import { getServerSession, type NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import clientPromise from "./lib/mongodb";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  adapter: MongoDBAdapter(clientPromise),
  session: {
    strategy: "jwt",
  },
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!email || !password) return null;

        const client = await clientPromise;
        const db = client.db();

        const user = await db.collection("users").findOne({
          email,
        });

        if (!user) return null;

        const isValid = await bcrypt.compare(password, user.password);

        if (!isValid) return null;

        return {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
        };
      },
    }),
  ],
};

export function auth() {
  return getServerSession(authOptions);
}
