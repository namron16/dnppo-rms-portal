// app/api/users/route.ts
// ─────────────────────────────────────────────
// REST API stubs for User Management.

import { NextResponse } from "next/server";

/** POST /api/users — create a new user */
export async function POST(request: Request) {
  const body = await request.json();

  if (!body.email || !body.name || !body.role) {
    return NextResponse.json(
      { error: "Missing required fields: email, name, role" },
      { status: 400 }
    );
  }

  if (!body.email.endsWith("@ddnppo.gov.ph")) {
    return NextResponse.json(
      { error: "Email must use the @ddnppo.gov.ph domain" },
      { status: 400 }
    );
  }

  const newUser = {
    id: `usr-${Date.now()}`,
    name: body.name,
    email: body.email,
    role: body.role,
    initials: body.name
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    avatarColor: "#3b63b8",
  };

  // TODO: Hash password, insert to DB, send welcome email
  return NextResponse.json({ data: newUser }, { status: 201 });
}
