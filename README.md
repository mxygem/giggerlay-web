# giggerlay web

A phone web app for loading an Amazon Flex van in stop order, built for Safari
on iPhone. It replaces the Route tab of the giggerlay iOS app.

1. **Import**: pick screenshots or a screen recording of Flex's
   Itinerary > List screen. The app reads them on the phone and builds the stop list.
2. **Check these**: shows missing numbers, shared addresses and guessed numbers;
   tap a stop to fix it.
3. **Load**: point the back camera at each label; the stop number shows huge in
   its zone color and is spoken.

Everything runs in the browser. Nothing is uploaded.

## Use
Open https://mxygem.github.io/giggerlay-web/ in Safari, then Share > Add to Home
Screen. The first import downloads the OCR engine (~10 MB), which is cached after.

## Develop
No build step; the repo root is the site.

```sh
npm test            # unit tests (node --test)
npm run serve       # http://localhost:8123/
npm run e2e         # synthetic 30-stop import test in headless Chromium
```

See SPEC.md for the behavior and CONTRACTS.md for the module layout.
Pushes to main run the tests and deploy to GitHub Pages.
