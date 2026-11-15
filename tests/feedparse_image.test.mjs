// tools/feedparse.mjs parseFeed(xml, { image: true }): the news job's items carry the picture the outlet's own feed offers
// (media:thumbnail, media:content image, an image enclosure, or the first <img> in the description), https only, no tracking
// pixels; without the option (every other job) items carry no image field. Run: node tests/feedparse_image.test.mjs
import assert from "node:assert/strict";
import { parseFeed } from "../tools/feedparse.mjs";
const xml = `<rss><channel>
<item><title>Thumb</title><link>https://o.test/1</link><media:thumbnail url="https://cdn.o.test/1.jpg?w=240&amp;h=160" width="240"/></item>
<item><title>Content</title><link>https://o.test/2</link><media:content url="https://cdn.o.test/2.jpg" medium="image"/></item>
<item><title>Enclosure</title><link>https://o.test/3</link><enclosure url="https://cdn.o.test/3.png" type="image/png" length="1"/></item>
<item><title>Desc</title><link>https://o.test/4</link><description>&lt;img src="https://cdn.o.test/4.jpg"&gt; text</description></item>
<item><title>Http</title><link>https://o.test/5</link><media:thumbnail url="http://cdn.o.test/5.jpg"/></item>
<item><title>Pixel</title><link>https://o.test/6</link><media:thumbnail url="https://stats.o.test/pixel.gif"/></item>
<item><title>Video</title><link>https://o.test/7</link><media:content url="https://cdn.o.test/7.mp4" medium="video"/></item>
<item><title>None</title><link>https://o.test/8</link></item>
</channel></rss>`;
const got = Object.fromEntries(parseFeed(xml, { image: true }).map((i) => [i.title, i.image]));
assert.equal(got.Thumb, "https://cdn.o.test/1.jpg?w=240&h=160");
assert.equal(got.Content, "https://cdn.o.test/2.jpg");
assert.equal(got.Enclosure, "https://cdn.o.test/3.png");
assert.equal(got.Desc, "https://cdn.o.test/4.jpg");
for (const t of ["Http", "Pixel", "Video", "None"]) assert.equal(got[t], undefined, t + " has no picture");
assert.ok(parseFeed(xml).every((i) => !("image" in i)), "other jobs' items carry no image field");
console.log("feedparse image: all passed");
