import "@/styles/tokens.css";
import type {ReactNode} from "react";
import {rubik} from "@/styles/fonts";

export default function DevLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en" className={rubik.variable}>
      <body>{children}</body>
    </html>
  );
}
