# Benjaire Flow kit (private)

Source of the downloadable kit sold on benjaire.com. Keep this repo private: it holds the paid product.

| Path | What |
|---|---|
| `kit/` | The kit exactly as buyers unzip it (inside `benjaire-flow-vX.Y.Z/`). Edit here; the version is the first heading in `kit/CHANGELOG.md`. |
| `build/pack.py` | Zips `kit/` into `benjaire-flow-vX.Y.Z.zip`. Same source and date give the same bytes. |
| `build/start-here.html` | With its fonts and images, renders `kit/00-START-HERE.pdf` (Chromium, US Letter, print backgrounds on). |
| `build/restructure-v1.0.1.py` | One-off script that turned the v1.0 layout into the numbered v1.0.1 folders. Kept for the record. |
| `live-ops/` | Benjaire's own running Flow setup (workflow exports, setup guide, security notes), as opposed to the kit sold to buyers. |

`npm run ci` checks every workflow export here: valid JSON, no pinned or static run data, no keys typed into nodes, and no Benjaire credential ids in the kit.

## Shipped versions

| Version | Released | Git tag | Zip SHA-256 |
|---|---|---|---|
| 1.0.1 | 2026-10-19 | `flow-v1.0.1` | `640c228272bcc82b6d7f9a4f2db116fb7a23f3f6948800c594b63a6dbe824653` |

The shipped zip is the file loaded into the n8n `shop_files` table and served by "Shop · Flow Starter delivery". Rebuild any version from its tag to get the identical file:

```bash
git checkout flow-v1.0.1
npm run flow:pack -- 2026-10-19      # writes products/flow/dist/ (git-ignored) and prints the SHA-256
```

## Ship a new version

1. Edit `kit/`, add the new version at the top of `kit/CHANGELOG.md`, and re-render the PDF if the guide changed.
2. Merge to `main`, then tag it: `git tag flow-vX.Y.Z && git push origin flow-vX.Y.Z`.
3. `npm run flow:pack -- <release date>`, and attach the zip to a GitHub release for that tag.
4. Add a row to the table above, add a new `shop_files` row in n8n, then point `kit_key` and `kit_filename` in `shop_settings` at it.

Moved here from the retired `benjaire-strategy` repository on 2026-10-26.
