# giggerlay web — spec

A phone web app for loading an Amazon Flex van in stop order. It replaces the
Route tab of the iOS app (giggerlay). Used from Safari on an iPhone 15 Pro Max.
This file is the spec; see CONTRACTS.md for the shared types and file layout.

## What it does
1. Import: pick screenshots and/or a screen recording of Flex's Itinerary > List
   screen. Read them on the phone, build the stop list, save it.
2. Review: show problems, let the user fix them.
3. Load: back camera reads each package label, shows the stop number huge in a
   zone color and says it out loud.

## Flex itinerary format (Itinerary > List)
```
# H-24.1B • Scheduled 3:00 - 8:00 AM     header row
9      1007 ANITA AVE                    pin number left of the street, same row
       GROSSE POINTE WOODS
       Deliver 1 package
```
Stop 1 is the station ("Pick up"); deliveries start at 2. Rows marked
"Pick up", "Pickup" or "Return..." are pickups and are left out.

## Amazon label format (OCR of a real label; recipient name replaced)
```
JANE DOE
10635 E HAMPTON AVE APT          street line ends in APT...
3056                             ...unit alone on a later line (can be below the city line)
MESA AZ 85209 -4164
TBA335791486589                  tracking, also in a barcode
05:00 - 08:00 / VAZ1 / 04:40 / 10/23 / 0.56 Lbs / ...
```
Labels also have ad text, a station sticker ("1 L03 / B12 DDD"), and a
handwritten bag code ("B10"). None of these may be read as addresses.

## Core logic (keep these rules)
**OCRLine**: {text, midY (top-origin, 0-1), minX (0-1), height}, sorted top to bottom.

**Street parsing**: house number (OCR O->0, I/l->1; never starts with 0, which
rules out "0.56 Lbs"), optional direction, name up to 3 tokens, street type,
optional unit. Ignore text after the type or a zip. Reject times, prices,
dates, and lines with count or weight words ("3 hr", "2 OF 3", "5 packages",
"Lbs"). Unit markers include APT and "AP" (OCR of APT). A street ending in APT
takes the first lone unit line (digits like "3056", not station codes like
"VAZ1") within the next 3 lines; a next line starting with a unit marker
("APT 12") also counts.

**Scoring a label against a stop**: house number must match exactly; name by
edit distance (min 0.6, token prefix 0.85); wrong direction -0.5; wrong type
-0.25; unit match +0.1, mismatch -0.3. Accept at 0.7. Result: stop, ambiguous
(another stop within 0.15 of best), notOnRoute (only when an unmatched line has
a real street type), or noAddress. Tracking IDs (TBA + 9-15 digits) come from
barcodes only, never OCR.

**Itinerary parsing per page** (a screenshot, a slice, or a video frame): a stop
is a street line with a street type, plain-word or ordinal name tokens, no
"SCHEDULED". Its pin is a 1-3 digit line ("9", "12)", never 0) at least 0.03 to
the left and within 0.03 vertically. Split "9 1007 ANITA AVE" into pin + street.
Packages from "Deliver N package(s)" within the next 3 lines.
- NEVER OCR a lone pin digit by cropping: 6 and 9 flip. Fill missing pins from
  row spacing measured between read pins on the same page; fill only at a whole
  number of rows with both sides agreeing, or one row from a single side.
- NEVER assume the next street found is the next stop.

**Across pages**: drop any number or street ever seen as a pickup. Vote per stop
number (most common street; ties go to one with a unit, then earliest; packages
by vote). Unnumbered readings matching a known stop (score >= 0.85) are dropped;
others get previous number + 1 and are marked guessed.

**Import**: slice images taller than 2.6x their width into screen-shaped tiles
(2.17x tall) with 30% overlap. For videos: skim small frames every 0.1s scoring
sharpness (mean vertical pixel change), then OCR the sharpest frame in each
0.4s window if it's at least 0.88x the video's 90th-percentile sharpness and
isn't a repeat (24x52 grayscale fingerprint, mean diff < 2). If blurry
stretches were skipped, say "record again a little slower". An import that
finds no stops leaves the saved route alone.

**Review ("Check these")**: missing numbers from stop 2 as ranges ("14-15"),
stops sharing street + unit, guessed numbers. Stop list colored by zone with
"Number guessed" and "N pkgs" tags. Tap a stop to fix its address (must parse
as a street); delete stops. Also a "type addresses" box to build a route by
hand, numbered from 1.

**Load screen**: camera with a guide frame, big stop number in the zone color,
the address, "Stops 2-11 · package 2 of 3". Orange "12 or 13" when ambiguous,
red "?" when not on route. A stop needs 2 agreeing frames; "not on route" needs
5. After 1s with no address, the next label is a new package (same stop
announced again); a different TBA barcode on the same stop also re-announces.
Count packages per stop by TBA. Zone colors (green, blue, orange, purple, pink,
teal, indigo, brown) change every N stops (setting, default 10) counted from
the first delivery stop. Speak the number (setting, default on). Footer:
packages and stops counted. Torch if supported, Done button, keep the screen
awake.

## Browser pieces
- OCR: Tesseract.js, pinned version. Return OCRLines with boxes.
- Barcodes: BarcodeDetector if Safari supports it, else zxing-js.
- Camera: getUserMedia back camera, OCR only the guide-frame crop, read barcodes
  first (cheap), throttle to what the phone can sustain.
- Voice: speechSynthesis, unlocked by the Start tap (iOS needs a gesture).
- Storage: IndexedDB or localStorage. Nothing leaves the phone; say so in the
  import footer.

## Testing
Unit tests for every rule above, including: the label sample picks 10635 E
HAMPTON AVE APT 3056 over decoys (Apt 2041 same building; 10653 vs 10635);
"0.56 Lbs", "3 hr", "2 OF 3", "VAZ1", "B10" are never addresses; filled pins
don't give a stop its neighbor's address. Render a synthetic 30-stop Flex list
in the real layout (stop 1 a pickup; 21 and 22 share an address; 14 has 3
packages) as a long screenshot and as frames, run the full import headless, and
report correct, missing, guessed and wrong stops.
