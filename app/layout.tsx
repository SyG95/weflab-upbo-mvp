import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Weflab Upbo",
  description: "스트리머 업보 기록을 팬과 함께 확인하는 페이지",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
