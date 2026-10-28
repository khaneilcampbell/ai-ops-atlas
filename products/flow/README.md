# Benjaire Flow kit (private)

Source of the downloadable kit sold on benjaire.com. Keep this repo private: it holds the paid product.

- `v1.0.1/src/`: the kit exactly as buyers unzip it (`benjaire-flow-v1.0.1/`).
- `v1.0.1/build/`: how it was made. `restructure.py` turns the v1.0 layout into the numbered folders; `start-here.html` plus its fonts and images renders `00-START-HERE.pdf` (Chromium, US Letter, print backgrounds on).
- `live-ops/`: Benjaire's own running Flow setup (workflow exports, setup guide, security notes), as opposed to the kit sold to buyers.
- `dist/benjaire-flow-v1.0.1.zip`: the file loaded into the n8n `shop_files` table and served by "Shop · Flow Starter delivery".

To ship a new version: build `src/`, zip it with the folder `benjaire-flow-vX.Y.Z/` at the root, add a new `shop_files` row, then point `kit_key` and `kit_filename` in `shop_settings` at it.

Moved here from the retired `benjaire-strategy` repository on 2026-10-26.
