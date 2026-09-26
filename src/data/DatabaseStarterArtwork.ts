import type { StarterTemplateId } from "./DatabaseStarterTemplates";

export interface StarterArtworkFile { path: string; content: string }

const themes: Record<StarterTemplateId, { bg: string; panel: string; ink: string; accent: string; soft: string; motif: string }> = {
  "project-tracker": { bg: "#162C42", panel: "#25445B", ink: "#F2F7F6", accent: "#78D1BE", soft: "#4F8290", motif: "project" },
  "content-calendar": { bg: "#543849", panel: "#795269", ink: "#FFF6F0", accent: "#F2B48F", soft: "#B87F89", motif: "calendar" },
  "reading-library": { bg: "#253D34", panel: "#426354", ink: "#FFF9E9", accent: "#D6C886", soft: "#7EA28C", motif: "books" },
  "research-library": { bg: "#253654", panel: "#3A5779", ink: "#F5F8FB", accent: "#A3D4DF", soft: "#7094B4", motif: "research" },
  "lightweight-crm": { bg: "#664333", panel: "#8C5D48", ink: "#FFF8F0", accent: "#F2C686", soft: "#BC8A72", motif: "contacts" },
  "task-planner": { bg: "#343A59", panel: "#555F86", ink: "#F9F8FF", accent: "#C8DCA0", soft: "#8E9DB7", motif: "tasks" },
};

function motif(type: string, ink: string, accent: string): string {
  switch (type) {
    case "project": return `<g fill="none" stroke="${ink}" stroke-width="8" stroke-linecap="round"><rect x="777" y="70" width="202" height="210" rx="19" opacity=".94"/><path d="M813 124h117M813 172h93M813 220h111"/><path d="m935 170 20 20 39-46" stroke="${accent}" stroke-width="12"/></g><circle cx="1018" cy="111" r="33" fill="${accent}" opacity=".9"/>`;
    case "calendar": return `<g fill="none" stroke="${ink}" stroke-width="8"><rect x="775" y="68" width="253" height="222" rx="20"/><path d="M775 124h253M824 49v45M976 49v45" stroke-linecap="round"/><path d="M826 161h31m37 0h31m37 0h31m-167 50h31m37 0h31m37 0h31m-167 50h31m37 0h31" stroke-linecap="round"/></g><circle cx="910" cy="209" r="22" fill="${accent}"/>`;
    case "books": return `<g stroke="${ink}" stroke-width="7" stroke-linejoin="round"><rect x="784" y="89" width="70" height="206" rx="8" fill="none"/><rect x="862" y="66" width="75" height="229" rx="8" fill="${accent}" stroke="none"/><rect x="947" y="110" width="70" height="185" rx="8" fill="none"/><path d="M800 247h38m125 0h38M881 129h37"/></g>`;
    case "research": return `<g fill="none" stroke="${ink}" stroke-width="6"><path d="M790 262 865 131 963 211 1034 84M790 262l173-51m-98-80 169-47" opacity=".85"/></g><g fill="${accent}"><circle cx="790" cy="262" r="18"/><circle cx="865" cy="131" r="22"/><circle cx="963" cy="211" r="17"/><circle cx="1034" cy="84" r="25"/></g>`;
    case "contacts": return `<g fill="none" stroke="${ink}" stroke-width="7"><circle cx="886" cy="115" r="40"/><path d="M806 273c0-48 35-79 80-79s80 31 80 79"/><circle cx="1035" cy="140" r="27"/><path d="M985 262c0-36 21-61 50-61s50 25 50 61"/></g><circle cx="780" cy="112" r="13" fill="${accent}"/>`;
    default: return `<g fill="none" stroke="${ink}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><rect x="775" y="78" width="255" height="211" rx="20"/><path d="m809 137 14 14 23-29m31 20h102m-170 59 14 14 23-29m31 20h102m-170 58 14 14 23-29m31 20h102"/></g><circle cx="1007" cy="87" r="21" fill="${accent}"/>`;
  }
}

export function starterCoverSvg(id: StarterTemplateId): string {
  const theme = themes[id];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 360" width="1200" height="360"><rect width="1200" height="360" fill="${theme.bg}"/><path d="M0 304c255-101 454-19 652-92s335-189 548-128v276H0Z" fill="${theme.panel}" opacity=".68"/><circle cx="1048" cy="180" r="237" fill="${theme.soft}" opacity=".24"/><path d="M62 0v360M166 0v360M270 0v360M374 0v360M478 0v360M582 0v360M686 0v360" stroke="${theme.ink}" stroke-opacity=".07"/><path d="M0 76h1200M0 180h1200M0 284h1200" stroke="${theme.ink}" stroke-opacity=".07"/><circle cx="117" cy="92" r="10" fill="${theme.accent}"/><path d="M97 161h378M97 179h285M97 234h192" stroke="${theme.ink}" stroke-opacity=".6" stroke-width="7" stroke-linecap="round"/>${motif(theme.motif, theme.ink, theme.accent)}</svg>`;
}

function readingThumbnail(index: number): string {
  const variants = [
    { bg: "#D4DACB", ink: "#315546", accent: "#E6B76C", shape: `<path d="M90 261V87q74-43 141 5v174q-70-47-141-5Zm141 5V92q72-48 141-5v174q-70-43-141 5Z" fill="none" stroke="#315546" stroke-width="9" stroke-linejoin="round"/>` },
    { bg: "#D8DCE9", ink: "#394A75", accent: "#E6A58F", shape: `<rect x="104" y="54" width="252" height="255" rx="10" fill="#F5F4EF"/><path d="M145 106h169m-169 37h169m-169 37h128m-128 53h169m-169 35h107" stroke="#394A75" stroke-width="9" stroke-linecap="round"/>` },
    { bg: "#E2D6CB", ink: "#683E46", accent: "#CC8C64", shape: `<rect x="91" y="75" width="279" height="209" rx="22" fill="#683E46"/><path d="m205 129 91 51-91 51Z" fill="#F8F3E9"/>` },
  ];
  const v = variants[index % variants.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 460 360" width="460" height="360"><rect width="460" height="360" fill="${v.bg}"/><circle cx="387" cy="53" r="101" fill="${v.accent}" opacity=".45"/><path d="M0 315c153-70 292-40 460-120v165H0Z" fill="${v.ink}" opacity=".1"/>${v.shape}</svg>`;
}

/** Paths are vault paths, not plugin paths, so Obsidian's native cover/gallery resolver works. */
export function getStarterArtworkFiles(id: StarterTemplateId, sourceFolder: string): StarterArtworkFile[] {
  const folder = `${sourceFolder.replace(/\/+$/, "")}/artwork`;
  const files = [{ path: `${folder}/database-cover.svg`, content: starterCoverSvg(id) }];
  if (id === "reading-library") {
    for (let index = 0; index < 3; index++) {
      files.push({ path: `${folder}/reading-${index + 1}.svg`, content: readingThumbnail(index) });
    }
  }
  return files;
}
