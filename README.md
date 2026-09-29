# Green City AI

A responsive frontend MVP for **Predict. Act. Grow.** — an environmental intelligence and action platform.

## Run locally

```bash
npm install
npm run dev
```

Then open the local Vite URL.

## Included in this MVP

- Reference-inspired Green City AI landing page with forest canvas, organic light centerpiece, ambient controls, and launch actions
- Regional environmental overview with health, trends, alerts, and AI-style insights
- Map-style regional explorer with layer controls and region selection
- Region-specific demo metrics for Coimbatore, Chennai, Bengaluru, and Ooty
- Green Missions discovery with saved missions and a full lifecycle:
  **Open → Accepted → In progress → Evidence submitted → Verified → Completed**
- Evidence upload interaction for the verification step
- Local persistence for region selection, mission status, saved missions, and City Builder scenarios
- Green Card participation profile and impact history
- Green City Builder with placeable environmental elements and live indicators
- Printable regional report view

The dashboard now includes a real data service with no API key required:

- **Open-Meteo** for current temperature, humidity, precipitation, and wind
- **NASA POWER / MERRA-2** for monthly historical temperature and precipitation
- **Microsoft Planetary Computer STAC** for recent low-cloud Sentinel-2 L2A observations and previews
- **Leaflet + OpenStreetMap / Esri World Imagery / NASA GIBS MODIS** for the interactive Explore Map
- NASA POWER monthly series are used to calculate real temperature and precipitation deltas against the prior period

Run the Vite development server to use the API middleware:

```bash
npm run dev
```

The data service lives in `api/handler.mjs` and is mounted through `vite.config.mjs`. For a production-style local server:

```bash
npm run build
npm start
```

The data service is intentionally conservative: climate readings and satellite metadata are real, while the existing canopy, water-health, and urban metrics remain illustrative until a land-cover processing pipeline is connected. Demo state is stored in the browser under `green-city-ai-state-v1` and can be cleared from browser storage.

## Optional Google authentication

The UI includes Google Identity Services support. To enable the real Google button:

1. Create an OAuth 2.0 Web application client in Google Cloud Console.
2. Add your local and deployed origins to **Authorized JavaScript origins**.
3. Copy `.env.example` to `.env`.
4. Set `VITE_GOOGLE_CLIENT_ID` to the web client ID.
5. Restart Vite.

Without a client ID, the sign-in dialog stays in clearly labelled demo-access mode. When configured, the app sends the ID token to `POST /api/auth/google`, which verifies it through Google's token-info endpoint. Production deployments should still issue their own server session and enforce permissions from the verified user.

The map uses real OpenStreetMap, Esri World Imagery, and NASA GIBS MODIS tiles by default, so it does not require a Google Maps key.

The local data model in `data.js` is the seam for replacing demo records with API responses. Google Earth Engine can be added behind the same API contract when service-account/project credentials are available.
