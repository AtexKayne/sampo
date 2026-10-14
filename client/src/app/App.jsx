import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DocumentMeta } from "./DocumentMeta.jsx";
import { AuthPage } from "../pages/AuthPage.jsx";
import { CalendarPage } from "../pages/CalendarPage.jsx";
import { SlotPage } from "../pages/SlotPage.jsx";
import { RequestsPage } from "../pages/RequestsPage.jsx";
import { RequestPage } from "../pages/RequestPage.jsx";
import { AvailabilityPage } from "../pages/AvailabilityPage.jsx";
import { AdminUserPage, ProfilePage } from "../pages/ProfilePage.jsx";
import { DancerPage } from "../pages/DancerPage.jsx";
import { NotificationsProvider } from "../notifications/NotificationsProvider.jsx";
import { SessionProvider } from "../session/SessionProvider.jsx";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <DocumentMeta />
        <SessionProvider>
          <NotificationsProvider>
            <Routes>
              <Route path="/login" element={<AuthPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route path="/slots/:id" element={<SlotPage />} />
              <Route path="/requests" element={<RequestsPage />} />
              <Route path="/requests/:id" element={<RequestPage />} />
              <Route path="/me" element={<ProfilePage />} />
              <Route path="/admin/users/:id" element={<AdminUserPage />} />
              <Route path="/dancers/:id" element={<DancerPage />} />
              <Route path="/me/availability" element={<AvailabilityPage />} />
              <Route path="/admin/slots" element={<Navigate to="/calendar" replace />} />
              <Route path="*" element={<Navigate to="/calendar" replace />} />
            </Routes>
          </NotificationsProvider>
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
