import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';

export async function GET() {
  try {
    const jsonDirectory = path.join(process.cwd(), 'public');
    const fileContents = await fs.readFile(jsonDirectory + '/afl-2025.json', 'utf8');
    const fixtures = JSON.parse(fileContents);
    return NextResponse.json(fixtures);
  } catch (error) {
    console.error('Failed to read fixtures file:', error);
    return NextResponse.json({ error: 'Failed to load fixtures' }, { status: 500 });
  }
}
