/** Mock office data driving the Default state. Swap for a real API later. */

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

export const OFFICES: Office[] = [
  {
    id: "engineering-floor",
    name: "Engineering Floor",
    org: "Zylker Technologies",
    theme: "blue",
    online: 4,
    members: [
      { initials: "PR", color: "#f4813f" },
      { initials: "AR", color: "#3f7ef4" },
      { initials: "KA", color: "#7c5cf4" },
    ],
    overflow: 1,
  },
  {
    id: "design-studio",
    name: "Design Studio",
    org: "Zylker Technologies",
    theme: "orange",
    online: 2,
    members: [
      { initials: "AN", color: "#2fa36a" },
      { initials: "VI", color: "#e0a53a" },
    ],
  },
  {
    id: "sales-growth",
    name: "Sales & Growth",
    org: "Fintellect Labs",
    theme: "green",
    online: 0,
    members: [],
  },
];
