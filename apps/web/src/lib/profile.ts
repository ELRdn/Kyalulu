import { useEffect, useState } from "react";
import { accountProfile, changeAccountProfile } from './accountProfile';
import { isCloud } from './cloudMode';

/** Local profiles stay on this device; hosted profiles belong to the account. */
const LS_NAME = "kyalulu-display-name";
const DEFAULT_NAME = "Traveler";

export function getDisplayName(): string {
  if (isCloud()) return accountProfile()?.display_name || DEFAULT_NAME;
  return localStorage.getItem(LS_NAME) || DEFAULT_NAME;
}

export function setDisplayName(name: string) {
  const v = name.trim() || DEFAULT_NAME;
  if (isCloud()) return changeAccountProfile({display_name:v});
  localStorage.setItem(LS_NAME, v);
  window.dispatchEvent(new Event("kyalulu-profile-change"));
}

export function useDisplayName(): string {
  const [name, setName] = useState(getDisplayName);
  useEffect(() => {
    const onChange = () => setName(getDisplayName());
    window.addEventListener("kyalulu-profile-change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("kyalulu-profile-change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return name;
}
