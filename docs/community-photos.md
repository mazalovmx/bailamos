# Community photographs and announcement export

## Installed photographs

The homepage uses user-supplied images from images/. Originals are unchanged. Public copies live in apps/web/public/images/community/, with the section mapping in apps/web/src/components/community-photo.tsx. Static WebP variants at 640 and 1280 pixels are served through srcset without the runtime image optimizer. The hero is prioritized, other images load lazily, and containers preserve source proportions on desktop and mobile. The current variants are approximately 43–163 KB each.

Regenerate variants after changing the PNG sources: `node apps/web/scripts/prepare-community-images.mjs`. Commit the generated WebP assets with the component changes so branch promotions retain the photographs.

| Section | Original file in images/ | Public copy |
| --- | --- | --- |
| Hero | 1950s Swing Dance Hall Jubilee.png | hero.png |
| Regular classes | Midcentury Swing Dance Hall.png | classes.png |
| Solo jazz and workshops | Vintage Swing Dance Lesson.png | lesson.png |
| Lindy Hop | Swing Dance in the Park.png | lindy-hop.png |
| Socials | Swing Night at the Jazz Club.png | social.png |

The lesson image appears twice because it demonstrates a solo step to a group. The duplicate Vintage Swing Dance Lesson (1).png and other alternatives remain in the source folder. Screen-reader descriptions are available in all three languages. To replace an image, update its public file and component proportions/description, then rebuild.

## Prompts for future alternatives

The following JPG names are suggestions, not the active automatic file mapping.

Shared style: realistic editorial dance photography, contemporary welcoming swing community, diverse adult dancers, warm natural light, subtle film grain, sage green and warm cream palette, natural candid expressions, anatomically correct hands and feet, authentic grounded swing dance posture, no acrobatics, no text, no logos, no watermark. These are illustrative community images, not photographs of an advertised real event.

| File | Size | Add to the shared prompt |
| --- | --- | --- |
| hero.jpg | 1600 × 2000 | A joyful adult couple dancing Lindy Hop in an airy wooden-floor dance hall, full bodies visible, relaxed bent knees, clear partner connection, a few softly blurred dancers behind them, main couple centered with generous space around them. |
| classes.jpg | 1600 × 1200 | A small friendly weekly beginner swing class, an adult teacher explaining a simple step to a semicircle of adult students, full bodies, bright neighbourhood studio, candid learning moment. |
| solo-jazz.jpg | 1600 × 1200 | An adult solo jazz dancer improvising rhythmic footwork, relaxed knees and playful expression, full body and feet visible, wooden floor, two people practising separately in the background. |
| lindy-hop.jpg | 1600 × 1200 | Two adult Lindy Hop dancers in open position holding one hand, natural counterbalance, joyful eye contact, full bodies visible, casual contemporary clothes, no ballroom hold or lifts. |
| workshops.jpg | 1800 × 1100 | An adult swing teacher demonstrating footwork during a focused workshop, small group of attentive adult participants, inclusive modern studio, full bodies, documentary composition. |
| social.jpg | 1800 × 1100 | A warm evening swing social with several adult couples dancing, small jazz band softly visible behind them, amber lighting, inviting community atmosphere, no staged crowd facing camera. |

For an initial replacement set, prioritize hero.jpg, solo-jazz.jpg and social.jpg. Do not put text in images: website headings are translated independently. Leave about 15% breathing room around the edges for alternative crops, and inspect anatomy and plausible dance posture before use.

## Announcement studio

/en/share, /es/share and /ru/share open a freeform announcement editor. Published event pages offer Share this event, prefilled with the selected date and a link in the caption.

Edit announcement / Preview & save links stay accessible on mobile. The Photo position slider adjusts vertical cropping after upload. The preview reflects export size and position. Empty text fields no longer reserve separate image blocks.

Photos stay in the browser and are not uploaded by this studio. PNG outputs are 1080×1350 (post), 1080×1920 (story/status) and 1080×1080 (square). Only one size is selected because each export is one file.

Share image opens the device share sheet following a user action. Available Instagram/WhatsApp targets depend on the device/apps. The fallback is to save the PNG, attach it manually and copy the caption. No automatic posting or social-account connection is performed. Feature detection uses navigator.canShare; public deployments require HTTPS. The bitmap has no clickable URL: the link is copied separately in the caption. [MDN Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share).

## Mobile discovery controls

City, style, event type, level, format, intensity, tempo and tag filters support multiple values. Matching uses OR within a group and AND across groups. Repeated query parameters survive pagination and locale switching. Event creation retains singular domain fields, such as one host city.

Each group offers Select all / Clear selection; when an internal search is active, Select matching options adds only matching choices. Applying submits the filters. On mobile, apply/reset controls remain at the bottom of the filter area while scrolling.
