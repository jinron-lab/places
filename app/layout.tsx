import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./home-dashboard.css";
import "./home-theme.css";
import "./responsive-app-shell.css";
import "./log/log-place.css";
import "./people/people.css";
import "./people/person-actions.css";
import "./app-theme.css";
import { JournalProvider } from "./journal-provider";
import { ServiceWorkerRegistration } from "./service-worker-registration";
import { AuthProvider } from "./auth-provider";

export const metadata: Metadata = {
  title: "Explore — Your personal place journal",
  description: "Keep a personal record of the places you visited and the memories attached to them.",
  applicationName: "Explore",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Explore",
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#2f8f87",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider><JournalProvider>{children}</JournalProvider></AuthProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
