import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { getAppConfig } from "@/lib/config";

const inter = Inter({ subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const cfg = getAppConfig();
  return {
    title: cfg.brandName,
    description: "私有化 AI 工作站 · 数据不出境 · 国产算力",
  };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cfg = getAppConfig();
  return (
    <html lang="zh-CN">
      <head>
        <style>{`:root { --accent: ${cfg.accentColor}; }`}</style>
      </head>
      <body className={`${inter.className} bg-slate-950 text-white antialiased`}>
        {children}
      </body>
    </html>
  );
}
