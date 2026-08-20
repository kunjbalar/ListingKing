import type { Metadata } from "next";
import "./styles.css";
import "./auth.css";

export const metadata: Metadata = { title: "ListingKing | Meesho catalog workflow", description: "Build and fill Meesho catalog listings safely." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
