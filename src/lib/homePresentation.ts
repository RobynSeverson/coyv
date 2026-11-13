import icon1 from "../assets/home-contact1.webp";
import icon2 from "../assets/home-contact2.webp";
import icon3 from "../assets/home-contact3.webp";
import icon4 from "../assets/home-contact4.webp";
import border1 from "../assets/home-border1.webp";
import border2 from "../assets/home-border2.webp";
import border3 from "../assets/home-border3.webp";
import type { HomeContact } from "./api";

export const homeBorders = [border1, border2, border3];
const contactIcons = [icon1, icon2, icon3, icon4];

/* UUIDs provide a shuffled but stable choice, shared by studio and public
   home. Never reuse a default; additional contacts stay text-only. */
export function contactIconSources(contacts: HomeContact[]): Map<string, string> {
  const available = [...contactIcons];
  return new Map(contacts.flatMap((contact) => {
    if (contact.icon) return [[contact.id, contact.icon.url]];
    if (!available.length) return [];
    let hash = 0;
    for (const character of contact.id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
    const [url] = available.splice(hash % available.length, 1);
    return url ? [[contact.id, url]] : [];
  }));
}
