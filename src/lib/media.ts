import { useEffect, useState } from "react";

/** The phone layout in mobile.css switches at this width. */
export const PHONE_QUERY = "(max-width: 760px), (max-height: 500px) and (pointer: coarse)";

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}
