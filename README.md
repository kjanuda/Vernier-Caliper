# Vernier Caliper — Next.js Compatibility Migration (Step 01)

This Next.js 15 App Router project runs the user-supplied 2D/3D Vernier Caliper browser engine **without rewriting its simulator logic**. The existing JavaScript Canvas/WebGL engine is hosted in a local same-origin document, displayed through a responsive React iframe wrapper.

**Important:** This is a Next.js wrapper around the legacy engine, NOT a complete React/TypeScript rewrite. This deliberately protects existing functionality and visual fidelity. A native React/TypeScript port is a separate refactor and needs regression tests.

## Run (Windows PowerShell or VS Code terminal)

```powershell
npm install
npm run dev
```

Open http://localhost:3000/tools/vernier-caliper/

## Project structure

- `app/layout.tsx` — Next.js root layout
- `app/tools/vernier-caliper/page.tsx` — Next.js simulator route
- `components/SimulatorFrame.tsx` — client component, same-origin iframe, height sync
- `public/tools/vernier-caliper/simulator.html` — original simulator page with tracking scripts removed and iframe height notification
- `public/tools/vernier-caliper/app.js` — original 2D simulator / controls (unchanged)
- `public/tools/vernier-caliper/vernier3d.js` — original 3D geometry / interaction engine (unchanged)
- `public/shared/gl3d.js` — WebGL helpers (unchanged)
- `public/tools/vernier-caliper/style.css`, `public/shared/site.css`, `assets/` — original styles and assets

## 3D verification

1. Open the Next.js route.
2. Drag the caliper jaws in 2D, change least-count and units.
3. Switch to the 3D view (loads `/shared/gl3d.js?v=3` and `/tools/vernier-caliper/vernier3d.js?v=...` lazily).
4. Drag, rotate and zoom the 3D view. Test reading synchronization from 2D to 3D.
5. Test quiz, random readings and reset; inspect Console for errors.
6. `npm run build`, then `npm start` and retest.

## Missing files in the user-provided ZIP

Some non-core user guide illustrations and related tool icons were not present in the supplied capture. The simulator engines, essential drawing sprites and stylesheet are included. Images to recover from a capture taken with permission:

- `public/tools/vernier-caliper/ug-hero.webp`
- `public/tools/vernier-caliper/screenshot-2.webp`
- `public/tools/vernier-caliper/screenshot-3.webp`
- `public/tools/vernier-caliper/screenshot-4.webp`
- `public/tools/vernier-caliper/screenshot-5.webp`
- `public/Icons/pressure-gauge.png`, `protractor.png`, `bevel-protractor.svg`, `ruler.png`

The user guide may show missing images until those are supplied. Site-wide links to pages not included in the supplied ZIP will not work locally. Google Analytics, ad loading, and Cloudflare tracking scripts have been intentionally excluded from the saved page; this can change ad placements compared to the live site.

## Development phases

**Step 01 (this project):** reproduce simulator through a Next.js route with the original engine, preserve the layout/interaction.  
**Step 02:** screenshot comparison and test 2D/3D with desktop/mobile. Recover missing user-guide assets.  
**Step 03:** extract UI controls into React components; keep engine as a dedicated client-only adapter.  
**Step 04:** migrate 2D and WebGL modules one at a time with baseline screenshots and functional tests.  
**Step 05:** deploy and run cross-browser regression tests.

## Ownership and permissions

These copied source files originated in the ZIP supplied by the user and may be third-party copyrighted material. No rights or license are granted by this migration. Retain source attribution and verify you have permission before redistributing, removing any branding, or deploying a public clone.
