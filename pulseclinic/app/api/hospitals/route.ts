import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/hospitals - List all hospitals from PostgreSQL
export async function GET() {
  try {
    const hospitals = await prisma.hospital.findMany({
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ success: true, count: hospitals.length, hospitals });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch hospitals";
    return NextResponse.json(
      {
        success: false,
        error: message,
        hint: "Please ensure your PostgreSQL password in .env matches your local PostgreSQL installation and that the 'healthcare_local' database exists.",
      },
      { status: 500 }
    );
  }
}

// POST /api/hospitals - Register a new hospital
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, code, licenseNumber, blockchainAddress, publicKey, email, phone, address, city, country, website } = body;

    if (!name || !code) {
      return NextResponse.json(
        { success: false, error: "Hospital 'name' and unique 'code' are required." },
        { status: 400 }
      );
    }

    const hospital = await prisma.hospital.create({
      data: {
        name,
        code,
        licenseNumber,
        blockchainAddress,
        publicKey,
        email,
        phone,
        address,
        city,
        country: country || "Ghana",
        website,
        isActive: true,
      },
    });

    return NextResponse.json({ success: true, hospital }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create hospital";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
