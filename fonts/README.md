# Bundled CV fonts

The lean template uses four static Bitstream Vera faces (`Vera.ttf`,
`VeraBd.ttf`, `VeraIt.ttf`, `VeraBI.ttf`), redistributed unmodified with
`bitstream-vera-license.txt`. They are embedded in PDFs, so font availability
on another computer does not change the Latin résumé's line wrapping.
Source distribution: ReportLab's bundled fonts. The template uses 11pt body
text and keeps the existing one-page rejection gate.

`templates/resume-template.html` embeds these files via `@font-face`, and
`generate-pdf.mjs` inlines them as `data:` URLs so PDF rendering makes no
network requests. Only the latin and latin-ext subsets are bundled.

- DM Sans 4.004 (variable): `dm-sans-latin.woff2`, `dm-sans-latin-ext.woff2`.
  Upstream: https://github.com/googlefonts/dm-fonts.
  License: `dm-sans-OFL.txt`.
- Space Grotesk 2.000 (variable): `space-grotesk-latin.woff2`,
  `space-grotesk-latin-ext.woff2`.
  Upstream: https://github.com/floriankarsten/space-grotesk.
  License: `space-grotesk-OFL.txt`.

Both families are distributed by Google Fonts under the SIL Open Font
License 1.1, which requires the license to accompany any redistribution. Each
`*-OFL.txt` carries the copyright line from that family's font `name` table.
The directory is flat because the template references `./fonts/{file}.woff2`
directly.
