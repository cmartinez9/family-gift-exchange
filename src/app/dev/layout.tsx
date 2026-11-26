import "@/styles/tokens.css";
import type {ReactNode} from "react";

export default function DevLayout({children}: {children: ReactNode}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
