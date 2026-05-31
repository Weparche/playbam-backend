import sharp from "sharp";

const INVITATION_BACKGROUND_MAP = {
  baloni: "/cura.webp",
  konfeti: "/pozivnica-boys.png",
  zvjezdice: "/pozivnica-mix.png",
  "pozivnica-bg": "/cura.webp",
  "pozivnica-bg1": "/pozivnica-mix.png",
  "pozivnica-boys": "/pozivnica-boys.png",
  "pozivnica-boys1": "/pozivnica-girls.png",
  "pozivnica-girl": "/cura.webp",
  "pozivnica-girl-animated": "/cura.webp",
  "pozivnica-boy": "/decko.webp",
  "pozivnica-girls": "/pozivnica-girls.png",
  "pozivnica-mix": "/pozivnica-mix.png",
  safari: "/safari.png",
  space: "/space.png",
  sport: "/sport.png",
  barbie: "/barbie.png",
  princess: "/princess.png",
  unicorns: "/unicorns.png",
  pirates: "/pirates.png",
  frozen: "/frozen.png",
  sirena: "/sirena.png",
  beba_cura: "/curica.webp",
  beba_decko: "/beba_decko.png",
};

const RSVP_MOOD_SYMBOLS = {
  party: { going: "🥳", maybe: "🤔", not_going: "💔" },
  sweet: { going: "🧁", maybe: "💭", not_going: "🥲" },
  icons: { going: "✦", maybe: "◌", not_going: "✕" },
  spark: { going: "✨", maybe: "👀", not_going: "🌧️" },
  balloon: { going: "🎈", maybe: "🤷", not_going: "🙅" },
  thumbs: { going: "👍", maybe: "🤷", not_going: "👎" },
  check: { going: "✅", maybe: "❔", not_going: "❌" },
  zoo: { going: "🐻", maybe: "🦊", not_going: "🐢" },
  sport: { going: "⚽", maybe: "🏃", not_going: "🤕" },
  space: { going: "🚀", maybe: "🛸", not_going: "🌑" },
  music: { going: "🎵", maybe: "🎧", not_going: "🔇" },
  crown: { going: "👑", maybe: "💎", not_going: "🪨" },
  heart: { going: "💖", maybe: "💛", not_going: "🖤" },
  fire: { going: "🔥", maybe: "⚡", not_going: "🧊" },
  nature: { going: "🌻", maybe: "🍂", not_going: "❄️" },
  pirate: { going: "🏴‍☠️", maybe: "⚓", not_going: "🦈" },
  birtija: { going: "🍻", maybe: "🐂", not_going: "🐴" },
  lica: { going: "😊", maybe: "🤷", not_going: "😢" },
};

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

export function buildInvitationHeroTitle(title, celebrantName) {
  const normalized = String(title ?? "")
    .trim()
    .replace(/\s+/g, " ");
  const merged = normalized.replace(/\|/g, " ").replace(/\s+/g, " ").trim();
  if (merged) {
    return merged;
  }
  const fallbackName = String(celebrantName ?? "")
    .trim()
    .replace(/\s+/g, " ") || "Slavljenik";
  return `${fallbackName} slavi rođendan!`;
}

export function formatInvitationDateText(dateValue) {
  const d = String(dateValue ?? "").trim();
  if (!d) {
    return "Datum uskoro";
  }
  const parsedDate = new Date(`${d}T12:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    return d;
  }
  const dayName = parsedDate
    .toLocaleDateString("hr-HR", { weekday: "long" })
    .replace(/^./, (letter) => letter.toUpperCase());
  const parts = d.split("-");
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (!year || !month || !day) {
    return d;
  }
  return `${dayName}, ${day}.${month}.${year}`;
}

export function formatInvitationTimeText(timeValue) {
  const normalized = String(timeValue ?? "").trim();
  if (!normalized) {
    return "Vrijeme uskoro";
  }
  if (normalized.includes("-") || /\bdo\b/i.test(normalized)) {
    return normalized
      .replace(/\s*-\s*/g, " - ")
      .replace(/(\d{2}:\d{2})(?!h)/g, "$1h");
  }
  const [startHour = "15", startMinute = "00"] = normalized.split(":");
  const startTotalMinutes = Number(startHour) * 60 + Number(startMinute);
  const endTotalMinutes = startTotalMinutes + 120;
  const endHour = String(Math.floor(endTotalMinutes / 60)).padStart(2, "0");
  const endMinute = String(endTotalMinutes % 60).padStart(2, "0");
  return `${normalized}h - ${endHour}:${endMinute}h`;
}

export function resolveInvitationBackgroundImage(coverImage, theme) {
  const coverKey = String(coverImage ?? "")
    .trim()
    .toLowerCase();
  const themeKey = String(theme ?? "")
    .trim()
    .toLowerCase();
  if (INVITATION_BACKGROUND_MAP[coverKey]) {
    return INVITATION_BACKGROUND_MAP[coverKey];
  }
  if (INVITATION_BACKGROUND_MAP[themeKey]) {
    return INVITATION_BACKGROUND_MAP[themeKey];
  }
  return "/cura.webp";
}

function normalizeRsvpMood(value) {
  const key = String(value ?? "")
    .trim()
    .toLowerCase();
  return key in RSVP_MOOD_SYMBOLS ? key : "party";
}

function getRsvpSymbol(mood, choice) {
  const symbols = RSVP_MOOD_SYMBOLS[normalizeRsvpMood(mood)] ?? RSVP_MOOD_SYMBOLS.party;
  return symbols[choice] ?? RSVP_MOOD_SYMBOLS.party[choice];
}

function escapeXml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(text, maxLen) {
  const value = String(text ?? "").trim();
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, maxLen - 1)}…`;
}

function wrapTitleLines(title, maxCharsPerLine = 22, maxLines = 3) {
  const words = title.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine) {
      current = next;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = word;
    if (lines.length >= maxLines) {
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length === 0) {
    return [truncate(title, maxCharsPerLine)];
  }

  if (words.join(" ").length > lines.join(" ").length && lines.length === maxLines) {
    lines[maxLines - 1] = truncate(lines[maxLines - 1], maxCharsPerLine);
  }

  return lines;
}

function buildOverlaySvg({
  heroTitle,
  dateText,
  timeText,
  venueText,
  rsvpMood,
}) {
  const titleLines = wrapTitleLines(heroTitle);
  const titleStartY = 118 - (titleLines.length - 1) * 16;
  const titleSvg = titleLines
    .map((line, index) => {
      const y = titleStartY + index * 44;
      return `<text x="600" y="${y}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="34" font-weight="700" fill="#2a2118">${escapeXml(line)}</text>`;
    })
    .join("");

  const going = getRsvpSymbol(rsvpMood, "going");
  const maybe = getRsvpSymbol(rsvpMood, "maybe");
  const notGoing = getRsvpSymbol(rsvpMood, "not_going");

  return `<svg width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000000" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect x="310" y="24" width="580" height="582" rx="28" fill="#f7f2eb" filter="url(#cardShadow)"/>
  <text x="600" y="72" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="0.08em" fill="#7a6a58">VIDIMOSE.HR</text>
  ${titleSvg}
  <text x="360" y="248" font-family="'Segoe UI', Arial, sans-serif" font-size="22" fill="#2a2118">📅 ${escapeXml(truncate(dateText, 44))}</text>
  <text x="360" y="292" font-family="'Segoe UI', Arial, sans-serif" font-size="22" fill="#2a2118">🕐 ${escapeXml(truncate(timeText, 44))}</text>
  <text x="360" y="336" font-family="'Segoe UI', Arial, sans-serif" font-size="22" fill="#2a2118">📍 ${escapeXml(truncate(venueText, 40))}</text>
  <text x="600" y="400" text-anchor="middle" font-family="Georgia, serif" font-size="24" font-weight="700" fill="#2a2118">Potvrdi dolazak</text>
  <rect x="352" y="420" width="156" height="54" rx="27" fill="#ffffff" stroke="#d8cbb8" stroke-width="2"/>
  <text x="430" y="455" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-size="18" font-weight="600" fill="#2a2118">${escapeXml(going)} Dolazimo</text>
  <rect x="522" y="420" width="156" height="54" rx="27" fill="#ffffff" stroke="#d8cbb8" stroke-width="2"/>
  <text x="600" y="455" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-size="18" font-weight="600" fill="#2a2118">${escapeXml(maybe)} Možda</text>
  <rect x="692" y="420" width="156" height="54" rx="27" fill="#ffffff" stroke="#d8cbb8" stroke-width="2"/>
  <text x="770" y="455" text-anchor="middle" font-family="'Segoe UI', Arial, sans-serif" font-size="18" font-weight="600" fill="#2a2118">${escapeXml(notGoing)} Ne dolazimo</text>
</svg>`;
}

export async function renderInvitationOgPng(invitation, webBaseUrl) {
  const origin = String(webBaseUrl ?? "https://vidimose.hr").replace(/\/$/, "");
  const imagePath = resolveInvitationBackgroundImage(invitation.coverImage, invitation.theme);
  const backgroundUrl = imagePath.startsWith("http")
    ? imagePath
    : `${origin}${imagePath.startsWith("/") ? "" : "/"}${imagePath}`;

  const backgroundResponse = await fetch(backgroundUrl);
  if (!backgroundResponse.ok) {
    throw new Error(`OG_BACKGROUND_FETCH_FAILED:${backgroundResponse.status}`);
  }

  const backgroundBuffer = Buffer.from(await backgroundResponse.arrayBuffer());
  const heroTitle = buildInvitationHeroTitle(invitation.title, invitation.celebrantName);
  const dateText = formatInvitationDateText(invitation.date);
  const timeText = formatInvitationTimeText(invitation.time);
  const venueText = String(invitation.location ?? "").trim() || "Lokacija uskoro";
  const overlaySvg = buildOverlaySvg({
    heroTitle,
    dateText,
    timeText,
    venueText,
    rsvpMood: invitation.rsvpMood,
  });

  const base = await sharp(backgroundBuffer)
    .resize(OG_WIDTH, OG_HEIGHT, { fit: "cover", position: "centre" })
    .modulate({ brightness: 0.92 })
    .toBuffer();

  return sharp(base)
    .composite([{ input: Buffer.from(overlaySvg), top: 0, left: 0 }])
    .png({ quality: 90, compressionLevel: 8 })
    .toBuffer();
}
