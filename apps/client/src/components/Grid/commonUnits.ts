export const commonUnits = {
  rank: "minmax(30px, 45px)",
  cover: "48px",
  options: "32px",
  duration: "120px",
  date: "200px",
  mainTitle: "3fr",
  secondaryTitle: "2fr",
  stat: (isMobile: boolean) => (isMobile ? "50px" : "140px"),
} as const;
