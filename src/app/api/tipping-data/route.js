import { CURRENT_YEAR } from '@/app/lib/constants';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const response = await fetch(`https://fixturedownload.com/feed/json/afl-${CURRENT_YEAR}`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch fixtures: ${response.status}`);
    }
    
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching fixtures:', error);
    return NextResponse.json(
      { error: 'Failed to fetch fixtures' },
      { status: 500 }
    );
  }
}