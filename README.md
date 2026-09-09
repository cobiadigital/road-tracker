# Road Tracker

A small PWA that answers one question: **how much time does driving faster actually save you?**

Set your speed and the distance left to go, and it shows the trip time plus what you'd
gain at +5, +10, +15, +20 and +25 mph. Savings shrink fast, which is the point.

## Features

- Defaults to 65 mph over 100 miles, editable with steppers, a slider, or by typing.
- Distance presets (25 / 50 / 100 / 250 / 500 mi) plus any custom value.
- Optional GPS speed: tap **Use GPS** and the baseline follows your real speed.
- Estimated arrival clock time for the baseline trip.
- Installable and works offline (service worker caches the app shell).
- Your last speed and distance are remembered locally.

## GPS notes (iOS in particular)

- Uses `watchPosition` with `enableHighAccuracy`. It prefers `coords.speed` from the GPS
  chip and falls back to deriving speed from consecutive fixes, smoothed with an EMA.
- Requests a **screen wake lock** while GPS is on (iOS 16.4+). iOS suspends JavaScript
  when the app is backgrounded or the screen locks, so the app must stay in the
  foreground for live speed to keep updating.
- If **Precise Location** is off, iOS returns a fuzzed fix; the app detects that
  (accuracy over 1000 m) and tells you how to turn it on.
- Editing the speed by hand turns GPS off, so manual input always wins.

## Layout

```
public/          static site (this is the whole app)
  index.html
  app.js         speed/distance state, math, geolocation
  styles.css
  sw.js          offline cache
  manifest.webmanifest
  icons/
wrangler.jsonc   Cloudflare Workers static-assets config
```

## Deploying

The repo is wired for **Cloudflare Workers Builds**: connect the repo in the Cloudflare
dashboard and every commit to the branch builds and deploys. No build step is needed;
the deploy command is `npx wrangler deploy`, which uploads `public/` as static assets.

To run it locally instead: `npm install && npm run dev`.

## The math

Trip time is `distance / speed`. Time saved at a higher speed is
`distance / speed − distance / (speed + increment)`. Savings assume you hold the higher
speed for the entire distance with no stops, traffic, or slowdowns.
