import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
    },
  });
}
