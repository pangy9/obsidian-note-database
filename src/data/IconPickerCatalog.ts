export interface EmojiCatalogItem { value: string; keywords: string }
export interface EmojiCatalogCategory { id: string; labelKey: string; nav: string; items: EmojiCatalogItem[] }

const items = (values: string, keywords: string): EmojiCatalogItem[] =>
  values.trim().split(/\s+/u).filter(Boolean).map((value) => ({ value, keywords }));

export const EMOJI_CATEGORIES: EmojiCatalogCategory[] = [
  { id: "people", labelKey: "recordIcon.category.people", nav: "🙂", items: items("😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😋 😜 🤪 🤨 🧐 🤓 😎 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😴 🤤 😪 😵 🤐 🤢 🤮 🤧 😷 🤒 🤕", "face people person smile emotion 人物 表情 笑脸" ) },
  { id: "nature", labelKey: "recordIcon.category.nature", nav: "🌿", items: items("🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦅 🦉 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🕷️ 🐢 🐍 🦎 🐙 🦑 🦀 🐠 🐟 🐬 🐳 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🎍 🎋 🍃 🍂 🍁 🌾 🌺 🌻 🌹 🌷 🌼 🌸 💐 🍄 🌍 🌙 ⭐ ✨ ⚡ 🔥 🌈", "nature animal plant weather 自然 动物 植物 天气" ) },
  { id: "food", labelKey: "recordIcon.category.food", nav: "🍎", items: items("🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🍞 🥖 🥨 🧀 🥚 🍳 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍥 🥠 🍦 🍧 🍨 🍩 🍪 🎂 🍰 🧁 🍫 🍬 🍭 🍮 🍯 ☕ 🍵 🧃 🥤 🍺 🍷", "food drink fruit meal 食物 饮料 水果" ) },
  { id: "activities", labelKey: "recordIcon.category.activities", nav: "⚽", items: items("⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🏓 🏸 🥅 🏒 🏑 🥍 🏏 ⛳ 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🪂 🏋️ 🤼 🤸 ⛹️ 🤺 🤾 🏌️ 🏇 🧘 🏄 🏊 🚣 🧗 🚴 🚵 🏆 🥇 🥈 🥉 🎖️ 🎯 🎮 🕹️ 🎲 ♟️ 🎨 🎭 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🎻", "activity sport game music art 活动 运动 游戏 音乐 艺术" ) },
  { id: "travel", labelKey: "recordIcon.category.travel", nav: "✈️", items: items("🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🛵 🏍️ 🚲 🛴 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ ⛽ 🚧 🚦 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏕️ 🏠 🏡 🏢 🏥 🏦 🏨 🏪 🏫", "travel transport place vehicle 旅行 交通 地点" ) },
  { id: "objects", labelKey: "recordIcon.category.objects", nav: "💡", items: items("⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💾 💿 📀 📷 📸 📹 🎥 📞 ☎️ 📺 📻 🎙️ ⏱️ ⏰ ⌛ 🔋 🔌 💡 🔦 🕯️ 🧯 🛢️ 💸 💵 💴 💶 💷 💰 💳 💎 ⚖️ 🧰 🔧 🔨 ⚒️ 🛠️ ⛏️ 🔩 ⚙️ 🧱 ⛓️ 🧲 🔫 💣 🧨 🪓 🔪 🛡️ 🚬 ⚰️ 🔮 📿 💈 ⚗️ 🔭 🔬 💊 💉 🩹 🩺 🚪 🛏️ 🛋️ 🚽 🚿 🛁 🧴 🧷 🧹 🧺 🧻 🧼 🧽 🧯 🛒 🎁 🎈 🎀 📦 ✉️ 📧 📩 📤 📥 📜 📄 📊 📈 📉 🗂️ 📅 📆 📇 📋 📌 📍 📎 🖇️ 📏 ✂️ 🖊️ ✏️ 🔍 🔒 🔑", "object tool office device 物品 工具 办公 设备" ) },
  { id: "symbols", labelKey: "recordIcon.category.symbols", nav: "✅", items: items("❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉️ ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ⛎ ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚛️ ☢️ ☣️ 📴 📳 🈶 🈚 🈸 🈺 🈷️ ✴️ 🆚 💮 🉐 ㊙️ ㊗️ 🈴 🈵 🈹 🈲 🅰️ 🅱️ 🆎 🆑 🅾️ 🆘 ❌ ⭕ 🛑 ⛔ 📛 🚫 💯 💢 ♨️ 🚷 🚯 🚳 🚱 🔞 📵 ❗ ❕ ❓ ❔ ‼️ ⁉️ 🔅 🔆 ⚜️ 🔱 ⚠️ ✅ ☑️ ✔️ ❎ ➕ ➖ ➗ ✖️ ♾️", "symbol heart check warning 符号 爱心 完成 警告" ) },
  { id: "flags", labelKey: "recordIcon.category.flags", nav: "🏳️", items: items("🏁 🚩 🎌 🏴 🏳️ 🏳️‍🌈 🏳️‍⚧️ 🇨🇳 🇭🇰 🇹🇼 🇯🇵 🇰🇷 🇸🇬 🇺🇸 🇨🇦 🇲🇽 🇧🇷 🇦🇷 🇬🇧 🇫🇷 🇩🇪 🇮🇹 🇪🇸 🇵🇹 🇳🇱 🇧🇪 🇨🇭 🇦🇹 🇸🇪 🇳🇴 🇩🇰 🇫🇮 🇮🇸 🇮🇪 🇵🇱 🇺🇦 🇷🇺 🇬🇷 🇹🇷 🇮🇳 🇹🇭 🇻🇳 🇮🇩 🇲🇾 🇵🇭 🇦🇺 🇳🇿 🇿🇦 🇪🇬 🇦🇪 🇸🇦 🇮🇱", "flag country nation 旗帜 国家" ) },
];

export const LUCIDE_CATEGORY_DEFINITIONS = [
  { id: "common", labelKey: "recordIcon.category.common", icon: "sparkles", ids: ["star", "heart", "check", "circle-check", "plus", "search", "settings", "home", "user", "users", "bookmark", "tag", "pin", "flag", "zap", "sparkles"] },
  { id: "interface", labelKey: "recordIcon.category.interface", icon: "layout-grid", keywords: ["arrow", "chevron", "panel", "layout", "menu", "more", "move", "maximize", "minimize", "rotate", "refresh", "filter", "list", "grid", "mouse", "pointer", "square", "circle", "toggle", "sidebar", "columns", "rows"] },
  { id: "files", labelKey: "recordIcon.category.files", icon: "file-text", keywords: ["file", "folder", "archive", "book", "notebook", "clipboard", "copy", "save", "download", "upload", "document", "paper", "sheet"] },
  { id: "communication", labelKey: "recordIcon.category.communication", icon: "message-circle", keywords: ["message", "mail", "send", "phone", "contact", "at-sign", "rss", "bell", "megaphone", "speech", "inbox"] },
  { id: "media", labelKey: "recordIcon.category.media", icon: "play", keywords: ["play", "pause", "music", "audio", "video", "camera", "image", "mic", "volume", "headphone", "film", "radio", "podcast"] },
  { id: "time", labelKey: "recordIcon.category.time", icon: "clock", keywords: ["clock", "calendar", "timer", "alarm", "hourglass", "history", "watch", "stopwatch"] },
  { id: "places", labelKey: "recordIcon.category.places", icon: "map-pin", keywords: ["map", "navigation", "compass", "plane", "car", "train", "ship", "bike", "building", "house", "tent", "route", "locate", "pin"] },
  { id: "business", labelKey: "recordIcon.category.business", icon: "briefcase-business", keywords: ["briefcase", "badge", "chart", "trending", "wallet", "credit-card", "banknote", "coins", "receipt", "shopping", "package", "store", "landmark", "percent"] },
] as const;

export function normalizeLucideIconId(id: string): string {
  return id.trim().toLowerCase().replace(/^lucide-/, "");
}

export function getLucideCategoryIds(categoryId: string, allIds: readonly string[]): string[] {
  const category = LUCIDE_CATEGORY_DEFINITIONS.find((item) => item.id === categoryId);
  if (!category) return [];
  const explicit = "ids" in category ? new Set<string>(category.ids) : new Set<string>();
  const keywords = "keywords" in category ? category.keywords : [];
  return allIds.filter((id) => {
    const normalized = normalizeLucideIconId(id);
    return explicit.has(normalized) || keywords.some((keyword) => normalized.includes(keyword));
  });
}
