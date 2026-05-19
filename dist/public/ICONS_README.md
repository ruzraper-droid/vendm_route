# PWA Icon Generation

The app requires PWA icons in various sizes. You can generate them from the provided `icon.svg` file.

## Required Icon Sizes

- 72x72
- 96x96
- 128x128
- 144x144
- 152x152
- 192x192 (minimum for PWA)
- 384x384
- 512x512 (recommended for PWA)

## Option 1: Online Tools

Use online tools to generate icons:
- https://realfavicongenerator.net/
- https://www.pwabuilder.com/imageGenerator

Upload `icon.svg` and download all sizes.

## Option 2: Using ImageMagick (if installed)

```bash
# Install ImageMagick
# macOS: brew install imagemagick
# Ubuntu: sudo apt-get install imagemagick
# Windows: https://imagemagick.org/script/download.php

# Generate all icon sizes
magick icon.svg -resize 72x72 icon-72x72.png
magick icon.svg -resize 96x96 icon-96x96.png
magick icon.svg -resize 128x128 icon-128x128.png
magick icon.svg -resize 144x144 icon-144x144.png
magick icon.svg -resize 152x152 icon-152x152.png
magick icon.svg -resize 192x192 icon-192x192.png
magick icon.svg -resize 384x384 icon-384x384.png
magick icon.svg -resize 512x512 icon-512x512.png
```

## Option 3: Using Node.js Script

Install sharp:
```bash
npm install --save-dev sharp
```

Run the generation script:
```bash
npm run generate-icons
```

## Screenshots

Create screenshots for the app store:
- `screenshot-mobile.png`: 540x720 (mobile view)
- `screenshot-desktop.png`: 1920x1080 (desktop view)

Take screenshots of your app and save them in the `public` folder.
