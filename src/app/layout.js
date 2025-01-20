import { Suspense } from 'react';
import { Geist, Geist_Mono } from "next/font/google";
import { connectToDatabase } from './lib/mongodb';
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Server Component to initialize DB connection
async function InitDB() {
    await connectToDatabase();
    return null;
}

export const metadata = {
  title: "Duzzatip",
  description: "2025",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Suspense fallback={null}>
          <InitDB />
        </Suspense>
        {children}
      </body>
    </html>
  );
}