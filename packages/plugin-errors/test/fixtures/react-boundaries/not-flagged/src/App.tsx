import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Header } from "./Header";
import { Layout } from "./Layout";
import { ProfilePanel, SettingsPanel, Toasted } from "./Panels";
import { SettingsPage } from "./SettingsPage";
import { UserPage } from "./UserPage";

export function App() {
  return (
    <BrowserRouter>
      <Header />
      <ProfilePanel />
      <SettingsPanel compact />
      <Toasted />
      <Layout>
        <Routes>
          <Route path="/users/:id" element={<UserPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
