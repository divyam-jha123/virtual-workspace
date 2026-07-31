/** Office types. Offices are created/joined by the user and persisted to
 *  localStorage — there is no default seed (a fresh account starts empty). */

export type Member = { initials: string; color: string };

export type Office = {
  id: string;
  name: string;
  org: string;
  /** Map-preview accent — drives the card's gradient. */
  theme: "blue" | "orange" | "green";
  online: number;
  members: Member[];
  /** Members beyond the shown avatars, rendered as a "+N" chip. */
  overflow?: number;
};
