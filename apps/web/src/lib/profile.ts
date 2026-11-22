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

const LS_BIO = "kyalulu-profile-bio";
const LS_AVATAR = "kyalulu-profile-avatar";
export type ProfileExtras = { bio: string; avatar: string };

export function getProfileExtras(): ProfileExtras {
  if (isCloud()) return { bio: accountProfile()?.bio || "", avatar: accountProfile()?.avatar || "" };
  try { return { bio: localStorage.getItem(LS_BIO) || "", avatar: localStorage.getItem(LS_AVATAR) || "" }; }
  catch { return { bio: "", avatar: "" }; }
}

export async function setProfileExtras(next: Partial<ProfileExtras>) {
  if (isCloud()) {
    // The account API accepts one field per revision.
    if (next.bio !== undefined) await changeAccountProfile({ bio: next.bio });
    if (next.avatar !== undefined) await changeAccountProfile({ avatar: next.avatar });
    return;
  }
  if (next.bio !== undefined) localStorage.setItem(LS_BIO, next.bio.trim());
  if (next.avatar !== undefined) localStorage.setItem(LS_AVATAR, next.avatar);
  window.dispatchEvent(new Event("kyalulu-profile-change"));
}

export function useProfileExtras(): ProfileExtras {
  const [value, setValue] = useState(getProfileExtras);
  useEffect(() => {
    const onChange = () => setValue(getProfileExtras());
    window.addEventListener("kyalulu-profile-change", onChange);
    return () => window.removeEventListener("kyalulu-profile-change", onChange);
  }, []);
  return value;
}

/** Square-crops a picked image to the 176px avatar the profile stores. */
export async function avatarFromFile(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 176;
  const side = Math.min(bitmap.width, bitmap.height);
  canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 176, 176);
  bitmap.close();
  return canvas.toDataURL("image/webp", 0.85);
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
