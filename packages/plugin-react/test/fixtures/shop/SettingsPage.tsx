import { useEffect } from "react";
import { useProfile, useSettings } from "./store.js";

export function SettingsPage() {
  const { settings } = useSettings();
  const { profile } = useProfile();
  useEffect(() => {
    document.body.dataset.theme = settings.dark ? "dark" : "light";
  }, [settings]);
  useEffect(() => {
    document.title = profile.name;
  }, [profile]);
  return <p>{profile.email}</p>;
}
