// The plugin ships its fonts inside main.js (Obsidian plugins are a single
// script), so the studio works offline and on mobile. All are SIL OFL 1.1.

import type { FontFile, FontLoader } from "../engine/fonts";
import eBGaramondRegular from "../../fonts/EBGaramond-Regular.ttf";
import eBGaramondItalic from "../../fonts/EBGaramond-Italic.ttf";
import eBGaramondBold from "../../fonts/EBGaramond-Bold.ttf";
import eBGaramondBoldItalic from "../../fonts/EBGaramond-BoldItalic.ttf";
import crimsonProRegular from "../../fonts/CrimsonPro-Regular.ttf";
import crimsonProItalic from "../../fonts/CrimsonPro-Italic.ttf";
import crimsonProBold from "../../fonts/CrimsonPro-Bold.ttf";
import crimsonProBoldItalic from "../../fonts/CrimsonPro-BoldItalic.ttf";
import cormorantGaramondMedium from "../../fonts/CormorantGaramond-Medium.ttf";
import cormorantGaramondMediumItalic from "../../fonts/CormorantGaramond-MediumItalic.ttf";
import montserratMedium from "../../fonts/Montserrat-Medium.ttf";
import montserratSemiBold from "../../fonts/Montserrat-SemiBold.ttf";
import atkinsonHyperlegibleRegular from "../../fonts/AtkinsonHyperlegible-Regular.ttf";
import atkinsonHyperlegibleItalic from "../../fonts/AtkinsonHyperlegible-Italic.ttf";
import atkinsonHyperlegibleBold from "../../fonts/AtkinsonHyperlegible-Bold.ttf";
import atkinsonHyperlegibleBoldItalic from "../../fonts/AtkinsonHyperlegible-BoldItalic.ttf";
import inconsolataRegular from "../../fonts/Inconsolata-Regular.ttf";

const FONTS: Record<FontFile, Uint8Array> = {
  "EBGaramond-Regular": eBGaramondRegular,
  "EBGaramond-Italic": eBGaramondItalic,
  "EBGaramond-Bold": eBGaramondBold,
  "EBGaramond-BoldItalic": eBGaramondBoldItalic,
  "CrimsonPro-Regular": crimsonProRegular,
  "CrimsonPro-Italic": crimsonProItalic,
  "CrimsonPro-Bold": crimsonProBold,
  "CrimsonPro-BoldItalic": crimsonProBoldItalic,
  "CormorantGaramond-Medium": cormorantGaramondMedium,
  "CormorantGaramond-MediumItalic": cormorantGaramondMediumItalic,
  "Montserrat-Medium": montserratMedium,
  "Montserrat-SemiBold": montserratSemiBold,
  "AtkinsonHyperlegible-Regular": atkinsonHyperlegibleRegular,
  "AtkinsonHyperlegible-Italic": atkinsonHyperlegibleItalic,
  "AtkinsonHyperlegible-Bold": atkinsonHyperlegibleBold,
  "AtkinsonHyperlegible-BoldItalic": atkinsonHyperlegibleBoldItalic,
  "Inconsolata-Regular": inconsolataRegular,
};

export const loadBundledFont: FontLoader = async (file) => FONTS[file];
